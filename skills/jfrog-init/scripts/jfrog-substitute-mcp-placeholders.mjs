#!/usr/bin/env node
// Rewrites a placeholder-style env-var reference in the JFrog plugin's
// mcp.json — specifically `mcpServers.jfrog.url`, nothing else in the
// file — with the real JPD URL from `jf config`. This is the ONLY code
// path in /jfrog-init that writes to the plugin-owned mcp.json.
//
// Scoped to that one field (rather than a file-wide text replace) so an
// unrelated MCP server entry or JSON value that happens to contain the
// same placeholder text is never touched.
//
// Placeholders handled (both `$VAR` and `${VAR}` forms):
//   - JFROG_PLATFORM_URL
//   - JFROG_URL
//
// The substitution normalizes the URL to the JPD root before writing, so
// `"url": "https://${JFROG_PLATFORM_URL}/mcp"` becomes
// `"url": "https://acme.jfrog.io/mcp"` regardless of what shape `.url`
// had in `jf config`.
//
// Idempotent: no matching placeholder = no write, exit 0. Atomic: write
// goes to a temp file next to the target and is renamed into place.
// Note: rewrites via JSON.parse/stringify (2-space indent), so unrelated
// formatting in the plugin's file is not preserved byte-for-byte.
//
// Exported as substituteMcpPlaceholders() — a pure function, no stdout
// writes — so jfrog-detect-jfrog-mcp.mjs can call it in-process instead of
// shelling out to a `node` subprocess and re-parsing its stdout, the same
// in-process pattern jfrog-resolve-jf-server.mjs/jfrog-resolve-mcp-config.mjs
// use. The CLI entry point below is a thin wrapper around the same function.
//
// Usage: node jfrog-substitute-mcp-placeholders.mjs <mcp-json-path> [server-id]
//
// Exit 0 -> substituted (or no substitution needed)
// Exit 1 -> no jf server configured, or resolved server-id has no url
// Exit 2 -> multiple jf servers configured, none marked default, no
//           server-id passed — ambiguous, caller must ask the user
// Exit 3 -> read/write error, or jf missing

import { existsSync, readFileSync, writeFileSync, renameSync, statSync, chmodSync, unlinkSync } from "node:fs";
import { emit as emitJf, isMainModule, jfAvailable, jfConfigShow, urlForServer, normalizeJpdUrl, mcpPlaceholderRegexes, jfrogMcpUrl, hasMcpPlaceholder, askServerResult, describeJfUnavailable } from "./lib/jf.mjs";
import { resolveJfServer } from "./jfrog-resolve-jf-server.mjs";

// Result shape: { exitCode, status, detail, candidates? } — mirrors the
// CLI contract above (status/candidates match what `emit()` would carry)
// so both the CLI wrapper below and in-process callers read the same
// fields without either one needing to re-derive them.
export function substituteMcpPlaceholders(target, serverIdOverride) {
  if (!target) {
    return { exitCode: 3, status: "error", detail: "usage: jfrog-substitute-mcp-placeholders.mjs <mcp-json-path> [server-id]" };
  }
  if (!existsSync(target)) {
    return { exitCode: 3, status: "error", detail: "target file does not exist" };
  }

  let raw;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    return { exitCode: 3, status: "error", detail: `could not read ${target}: ${err.message}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { exitCode: 3, status: "error", detail: "target file is not valid JSON — refusing to modify" };
  }

  const currentUrl = jfrogMcpUrl(parsed);

  if (currentUrl === null) {
    return { exitCode: 0, status: "green", detail: "no mcpServers.jfrog.url present — nothing to substitute" };
  }

  // Checked before resolving a jf server at all — an unresolvable/ambiguous
  // server shouldn't turn a jfrog.url that has no placeholder into a red/ask
  // result; there's nothing here that needs the server to fix.
  if (!hasMcpPlaceholder(currentUrl)) {
    return { exitCode: 0, status: "green", detail: "no placeholder found — nothing to substitute" };
  }

  if (!jfAvailable()) {
    return { exitCode: 3, status: "error", detail: describeJfUnavailable() };
  }
  const configList = jfConfigShow();
  const resolvedId = resolveJfServer(serverIdOverride, configList);
  if (!resolvedId) {
    if (configList.length === 0) {
      return { exitCode: 1, status: "red", detail: "no jf server configured — run `jf config add --interactive`" };
    }
    const ask = askServerResult("mcp-placeholder", configList);
    return { exitCode: 2, status: "ask", detail: ask.detail, candidates: ask.candidates };
  }

  const jpdUrl = normalizeJpdUrl(urlForServer(configList, resolvedId));
  if (!jpdUrl) {
    return { exitCode: 1, status: "red", detail: `server-id '${resolvedId}' has no url in jf config` };
  }

  const { withScheme, bare } = mcpPlaceholderRegexes();

  // Both forms replace the full match with jpdUrl itself (which already
  // carries the correct scheme) rather than preserving whatever scheme
  // literally preceded the placeholder in the plugin's mcp.json — that text
  // reflects the plugin's shipped template, not the real JPD's scheme.
  let newUrl = currentUrl.replace(withScheme, () => jpdUrl);
  newUrl = newUrl.replace(bare, () => jpdUrl);

  parsed.mcpServers.jfrog.url = newUrl;
  const rewritten = JSON.stringify(parsed, null, 2) + "\n";

  const tmp = `${target}.tmp.${process.pid}`;
  try {
    // "wx" refuses to follow/overwrite anything already at tmp (e.g. a
    // pre-planted symlink) — same symlink-safe pattern as
    // lib/project-cache.mjs's writeCachedProjectList().
    writeFileSync(tmp, rewritten, { flag: "wx" });
    // rename() replaces the target's inode wholesale, so without this the
    // file would silently pick up writeFileSync's default umask-derived
    // mode instead of the target's own — e.g. a 0600 mcp.json holding
    // another MCP server's secrets in its env block would come back 0644
    // (world-readable) after a substitution that has nothing to do with
    // that other entry.
    chmodSync(tmp, statSync(target).mode & 0o777);
    renameSync(tmp, target);
  } catch (err) {
    // A run killed between the write and the rename (Ctrl-C, OOM, harness
    // timeout) leaves tmp behind; the name is only unique per PID, so the
    // next run to reuse that PID would otherwise hit EEXIST here forever.
    // Same cleanup as jfrog-install-jf-cli.mjs's direct-download temp write.
    try {
      unlinkSync(tmp);
    } catch {
      // Never created, already renamed, or not ours to remove.
    }
    return { exitCode: 3, status: "error", detail: `could not write ${target}: ${err.message}` };
  }

  return { exitCode: 0, status: "green", detail: `substituted JFROG_PLATFORM_URL/JFROG_URL placeholder with ${jpdUrl}` };
}

if (isMainModule(import.meta.url)) {
  const TARGET = process.argv[2] || "";
  const SERVER_ID = process.argv[3] || "";
  const result = substituteMcpPlaceholders(TARGET, SERVER_ID);
  emitJf({
    check: "mcp-placeholder",
    status: result.status,
    file: TARGET,
    detail: result.detail,
    ...(result.candidates ? { candidates: result.candidates } : {}),
  });
  // Sets process.exitCode rather than calling process.exit() — a forced
  // exit can truncate a still-draining stdout write, same reason every
  // other script in this skill was already fixed this way.
  process.exitCode = result.exitCode;
}
