#!/usr/bin/env node
// Verifies the JFrog PLUGIN'S OWN mcp.json (per harness) exists at its
// installed path AND contains an mcpServers.jfrog entry. This file is
// owned by the plugin — we NEVER write to it, with one exception:
// automatic placeholder substitution (see jfrog-substitute-mcp-placeholders.mjs).
// If it's missing, malformed, or lacks the jfrog entry, the correct fix
// is "reinstall or update the JFrog plugin".
//
// NO endpoint reachability probe — this is a pure "is the plugin
// configured?" check. The walk's other network checks already prove the
// JPD is reachable, and a dead endpoint surfaces immediately the first
// time the user invokes the MCP.
//
// Idempotent, read-only, zero mutation (aside from the placeholder fix).
//
// Usage: node jfrog-detect-jfrog-mcp.mjs [server-id]
//
// [server-id] is forwarded as-is to jfrog-substitute-mcp-placeholders.mjs
// so the placeholder fix reuses the same server the caller already
// resolved (e.g. in Step 4), instead of re-resolving from scratch.
//
// Exit 0 -> green (plugin entry present)
// Exit 1 -> red   (plugin file missing/empty/not installed, or missing jfrog entry)
// Exit 2 -> ask   (placeholder present but the jf server-id is ambiguous —
//                  caller must prompt from `candidates` and re-invoke)
// Exit 3 -> error (harness could not be detected, plugin mcp.json is invalid
//                  JSON, or the file could not be read)

import { readFileSync, statSync } from "node:fs";
import { emit as emitJf, hasMcpPlaceholder, isMainModule, jfrogMcpUrl } from "./lib/jf.mjs";
import { resolveMcpConfig } from "./jfrog-resolve-mcp-config.mjs";
import { substituteMcpPlaceholders } from "./jfrog-substitute-mcp-placeholders.mjs";

function emit(status, file, detail, extra = {}) {
  emitJf({ check: "jfrog-mcp", status, file, detail, ...extra });
}

// Surfaces the substituter's own failure detail (ambiguous server w/
// candidates, no url set in jf config, or a read/write error) instead of
// one hardcoded message, so the user is pointed at the actual cause
// instead of always being told to check the JPD URL even when the real
// issue is an ambiguous server-id.
function substituterFailureDetail(result) {
  return Array.isArray(result.candidates) && result.candidates.length
    ? `${result.detail} (candidates: ${result.candidates.join(", ")})`
    : result.detail;
}

// Exported so jfrog-detect-all.mjs can call this in-process instead of
// shelling out to a `node` subprocess and re-parsing its stdout — the
// same in-process pattern jfrog-resolve-jf-server.mjs /
// jfrog-resolve-mcp-config.mjs / jfrog-substitute-mcp-placeholders.mjs
// use. The CLI entry point below is a thin wrapper around this function.
//
// Returns the exit code rather than calling process.exit() — a forced
// exit can truncate the JSON line's stdout write if it's still draining
// through a pipe.
export function detectJfrogMcp(serverIdArg) {
  const SERVER_ID = serverIdArg || "";
  const resolved = resolveMcpConfig();
  if (!resolved.path) {
    // code 2 = plugin file not installed on disk ("reinstall the plugin");
    // code 1 = harness could not be detected.
    const status = resolved.code === 2 ? "red" : "error";
    emit(status, "", resolved.error.replace(/\s+/g, " ").replace(/"/g, "'"));
    return resolved.code === 2 ? 1 : 3;
  }

  const target = resolved.path;

  // A single guarded stat instead of existsSync()+statSync() — two
  // separate calls leave a TOCTOU window where the file can vanish
  // between them (plugin reinstall, concurrent placeholder-substitution
  // rename) and throw an uncaught ENOENT that would crash the whole walk.
  let size;
  try {
    size = statSync(target).size;
  } catch {
    size = 0;
  }
  if (size === 0) {
    emit("red", target, "plugin mcp.json is missing or empty — reinstall or update the JFrog plugin");
    return 1;
  }

  let raw;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    emit("error", target, `could not read ${target}: ${err.message}`);
    return 3;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    emit("error", target, "plugin mcp.json is not valid JSON — reinstall or update the JFrog plugin");
    return 3;
  }

  // Auto-substitute any `${JFROG_PLATFORM_URL}` / `${JFROG_URL}` placeholder
  // with the real JPD URL from `jf config`. Left in place, the MCP would
  // fail to load in the IDE/agent since the env var doesn't exist.
  // Checked against mcpServers.jfrog.url specifically (not the raw file
  // text) so a placeholder-shaped string elsewhere in the plugin's
  // mcp.json — an unrelated MCP entry, say — can't trigger substitution
  // for a jfrog.url that has none.
  const preSubstitutionUrl = jfrogMcpUrl(parsed);
  if (typeof preSubstitutionUrl === "string" && hasMcpPlaceholder(preSubstitutionUrl)) {
    const result = substituteMcpPlaceholders(target, SERVER_ID);
    if (result.exitCode === 2) {
      // Ambiguous jf server-id — pass the structured candidates through
      // instead of collapsing to red, so the caller can re-prompt the
      // same way it would for any other ambiguous-server case.
      emit("ask", target, result.detail, { unresolved: "server", candidates: result.candidates });
      return 2;
    }
    if (result.exitCode !== 0) {
      // Preserve the substituter's own red/error distinction (exit 1 vs 3)
      // instead of collapsing both into red — Step 5 in SKILL.md relies on
      // that distinction to pick the right Final Summary wording.
      const status = result.status === "error" ? "error" : "red";
      emit(status, target, `plugin mcp.json contains a JFROG_PLATFORM_URL placeholder and automatic substitution failed — ${substituterFailureDetail(result)}`);
      return status === "error" ? 3 : 1;
    }
    try {
      parsed = JSON.parse(readFileSync(target, "utf8"));
    } catch (err) {
      emit("error", target, `substitution succeeded but re-reading ${target} failed: ${err.message}`);
      return 3;
    }
  }

  const url = jfrogMcpUrl(parsed);
  const hasUrl = typeof url === "string" && url.trim() !== "";
  if (!hasUrl) {
    emit("red", target, "plugin mcp.json has no valid mcpServers.jfrog entry (missing or empty url) — reinstall or update the JFrog plugin");
    return 1;
  }

  emit("green", target, "plugin mcp.json present with mcpServers.jfrog entry");
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = detectJfrogMcp(process.argv[2]);
}
