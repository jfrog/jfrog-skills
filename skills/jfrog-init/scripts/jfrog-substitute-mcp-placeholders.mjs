#!/usr/bin/env node
// Replaces $JFROG_PLATFORM_URL / $JFROG_URL placeholders in the jfrog entry's
// url field (`mcpServers.jfrog`, bare `jfrog` on Codex, or `mcp.jfrog` on
// OpenCode) with the real JPD URL from `jf config`. Atomic write, idempotent,
// symlink-safe.
//
// Usage: node jfrog-substitute-mcp-placeholders.mjs <mcp-json-path> [server-id]
//
// Exit 0 -> substituted (or no placeholder found)
// Exit 1 -> no jf server configured, or server-id has no url
// Exit 2 -> ambiguous server — caller must ask
// Exit 3 -> read/write error or jf missing

import { existsSync, readFileSync, writeFileSync, renameSync, statSync, chmodSync, unlinkSync, realpathSync } from "node:fs";
import { emit as emitJf, isMainModule, jfAvailable, jfConfigShow, urlForServer, normalizeJpdUrl, mcpPlaceholderRegexes, jfrogMcpEntry, hasMcpPlaceholder, askServerResult, describeJfUnavailable } from "./lib/jf.mjs";
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

  const entry = jfrogMcpEntry(parsed);
  const currentUrl = entry !== null && typeof entry?.url === "string" ? entry.url : null;

  if (currentUrl === null) {
    return { exitCode: 0, status: "green", detail: "no jfrog entry url present — nothing to substitute" };
  }

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

  let newUrl = currentUrl.replace(withScheme, () => jpdUrl);
  newUrl = newUrl.replace(bare, () => jpdUrl);

  entry.url = newUrl;
  const rewritten = JSON.stringify(parsed, null, 2) + "\n";

  const real = realpathSync(target);
  const tmp = `${real}.tmp.${process.pid}`;
  try {
    // "wx" refuses to follow/overwrite anything already at tmp (e.g. a
    // pre-planted symlink) — same symlink-safe pattern as
    // lib/project-cache.mjs's writeCachedProjectList(). mode: 0o600 closes
    // the window between writeFileSync and chmodSync where sibling MCP tokens
    // in the same file would be world-readable.
    writeFileSync(tmp, rewritten, { flag: "wx", mode: 0o600 });
    // rename() replaces the target's inode wholesale, so without this the
    // file would silently pick up writeFileSync's default umask-derived
    // mode instead of the target's own — e.g. a 0600 mcp.json holding
    // another MCP server's secrets in its env block would come back 0644
    // (world-readable) after a substitution that has nothing to do with
    // that other entry.
    chmodSync(tmp, statSync(real).mode & 0o777);
    renameSync(tmp, real);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* not created, already renamed, or not ours */ }
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
  process.exitCode = result.exitCode;
}
