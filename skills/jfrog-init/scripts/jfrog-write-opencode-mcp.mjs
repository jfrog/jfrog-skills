#!/usr/bin/env node
// Writes a `mcp.jfrog` entry into the user's OpenCode config, sourced from
// `jf config`. Idempotent, atomic; refuses non-JSON files (including .jsonc).
// Exported as writeOpencodeMcp() for in-process calls.
//
// Usage: node jfrog-write-opencode-mcp.mjs <opencode-config-path> [server-id]
//
// Exit 0 -> written (or already present)
// Exit 1 -> no jf server configured, or server-id has no url
// Exit 2 -> ambiguous server, no default — caller must ask
// Exit 3 -> read/write error, jf missing, or file can't take the entry

import { existsSync, readFileSync, writeFileSync, renameSync, realpathSync, statSync, chmodSync, unlinkSync } from "node:fs";
import { emit as emitJf, isMainModule, jfAvailable, jfConfigShow, urlForServer, normalizeJpdUrl, askServerResult, describeJfUnavailable } from "./lib/jf.mjs";
import { resolveJfServer } from "./jfrog-resolve-jf-server.mjs";

// Result shape: { exitCode, status, detail, candidates? }
export function writeOpencodeMcp(target, serverIdOverride) {
  if (!target) {
    return { exitCode: 3, status: "error", detail: "usage: jfrog-write-opencode-mcp.mjs <opencode-config-path> [server-id]" };
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
    return {
      exitCode: 3,
      status: "error",
      detail: "target file is not valid JSON — refusing to modify; paste the entry in manually",
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      exitCode: 3,
      status: "error",
      detail: "target file is not a JSON object — refusing to modify; paste the entry in manually",
    };
  }

  // Refuse to overwrite a non-object mcp value; absent/null is creatable.
  if (parsed.mcp != null && (typeof parsed.mcp !== "object" || Array.isArray(parsed.mcp))) {
    return {
      exitCode: 3,
      status: "error",
      detail: "the target file's `mcp` key is not a JSON object — refusing to modify; paste the entry in manually",
    };
  }

  // Check mcp.jfrog directly — jfrogMcpEntry() prefers mcpServers over mcp,
  // so a config carrying both mcpServers (for another tool) and mcp.jfrog
  // (the valid jfrog entry) would cause it to return null and trigger an
  // overwrite of the existing entry. Direct lookup is safe here because
  // writeOpencodeMcp is OpenCode-specific; mcp.jfrog is always the target shape.
  const existingEntry = parsed.mcp?.jfrog;
  if (existingEntry !== null && existingEntry !== undefined && typeof existingEntry === "object" && !Array.isArray(existingEntry)) {
    return { exitCode: 0, status: "green", detail: "mcp.jfrog entry already present — left untouched" };
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
    const ask = askServerResult("opencode-mcp-write", configList);
    return { exitCode: 2, status: "ask", detail: ask.detail, candidates: ask.candidates };
  }

  const jpdUrl = normalizeJpdUrl(urlForServer(configList, resolvedId));
  if (!jpdUrl) {
    return { exitCode: 1, status: "red", detail: `server-id '${resolvedId}' has no url in jf config` };
  }

  if (parsed.mcp == null) {
    parsed.mcp = {};
  }
  parsed.mcp.jfrog = { type: "remote", url: `${jpdUrl}/mcp`, enabled: true };
  const rewritten = JSON.stringify(parsed, null, 2) + "\n";

  // Resolve symlinks before rename so dotfiles-managed configs stay linked.
  let real;
  let mode;
  try {
    real = realpathSync(target);
    mode = statSync(real).mode & 0o777;
  } catch (err) {
    return { exitCode: 3, status: "error", detail: `could not resolve ${target}: ${err.message}` };
  }

  const tmp = `${real}.tmp.${process.pid}.${Date.now()}`;
  try {
    // "wx" refuses to overwrite a pre-planted symlink; chmod locks in the
    // target's exact mode rather than relying on the umask default.
    writeFileSync(tmp, rewritten, { flag: "wx", mode });
    chmodSync(tmp, mode);
    renameSync(tmp, real);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Never created, already renamed, or not ours to remove.
    }
    return { exitCode: 3, status: "error", detail: `could not write ${target}: ${err.message}` };
  }

  return { exitCode: 0, status: "green", detail: `wrote mcp.jfrog entry pointing at ${jpdUrl}` };
}

if (isMainModule(import.meta.url)) {
  const TARGET = process.argv[2] || "";
  const SERVER_ID = process.argv[3] || "";
  const result = writeOpencodeMcp(TARGET, SERVER_ID);
  emitJf({
    check: "opencode-mcp-write",
    status: result.status,
    file: TARGET,
    detail: result.detail,
    ...(result.candidates ? { candidates: result.candidates } : {}),
  });
  process.exitCode = result.exitCode;
}
