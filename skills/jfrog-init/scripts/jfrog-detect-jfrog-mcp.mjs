#!/usr/bin/env node
// Verifies the JFrog jfrog entry exists in the current harness's MCP
// config AND has a non-empty url. For Cursor/VS Code/Claude/Codex this is
// the plugin's own mcp.json, never written to except for placeholder
// substitution (see jfrog-substitute-mcp-placeholders.mjs); OpenCode has
// no plugin-owned config, so a missing entry is written via
// jfrog-write-opencode-mcp.mjs instead.
//
// NO endpoint reachability probe — this is a pure "is the plugin
// configured?" check. The walk's other network checks already prove the
// JPD is reachable, and a dead endpoint surfaces immediately the first
// time the user invokes the MCP.
//
// Idempotent, read-only, zero mutation (aside from the placeholder fix and
// the OpenCode write, both of which are themselves idempotent).
//
// Usage: node jfrog-detect-jfrog-mcp.mjs [server-id]
//
// [server-id] is forwarded to the fixer so it reuses the server resolved in Step 4.
//
// Exit 0 -> green (plugin entry present)
// Exit 1 -> red   (plugin file missing/empty/not installed, or missing jfrog entry)
// Exit 2 -> ask   (placeholder present, or OpenCode entry missing, but the jf
//                  server-id is ambiguous — caller must prompt from
//                  `candidates` and re-invoke)
// Exit 3 -> error (harness could not be detected, plugin mcp.json is invalid
//                  JSON, or the file could not be read)

import { readFileSync, statSync } from "node:fs";
import { emit as emitJf, hasMcpPlaceholder, isMainModule, jfrogMcpEntry, jfrogMcpUrl } from "./lib/jf.mjs";
import { resolveMcpConfig } from "./jfrog-resolve-mcp-config.mjs";
import { substituteMcpPlaceholders } from "./jfrog-substitute-mcp-placeholders.mjs";
import { writeOpencodeMcp } from "./jfrog-write-opencode-mcp.mjs";

function emit(status, file, detail, extra = {}) {
  emitJf({ check: "jfrog-mcp", status, file, detail, ...extra });
}

// Extracts the failure reason from a fixer result, appending candidates when
// the server is ambiguous. Shared by substituteMcpPlaceholders / writeOpencodeMcp.
function fixerFailureDetail(result) {
  return Array.isArray(result.candidates) && result.candidates.length
    ? `${result.detail} (candidates: ${result.candidates.join(", ")})`
    : result.detail;
}

// Exported for in-process calls; returns exit code (process.exit() risks
// truncating a still-draining stdout pipe).
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

  let target = resolved.path;
  const harness = resolved.harness;

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
    const detail = harness === "opencode" ? "OpenCode config file is empty — add the mcp.jfrog entry manually" : "plugin mcp.json is missing or empty — reinstall or update the JFrog plugin";
    emit("red", target, detail);
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
    // OpenCode's config may be user-authored .jsonc — a parse failure
    // there isn't "reinstall the plugin" (no plugin file exists).
    const detail =
      harness === "opencode"
        ? "OpenCode config is not valid JSON (likely .jsonc with comments) — add the mcp.jfrog entry manually"
        : "plugin mcp.json is not valid JSON — reinstall or update the JFrog plugin";
    emit("error", target, detail);
    return 3;
  }

  // The global file may already have an entry that this layer would
  // otherwise shadow — defer to it if so (see resolveMcpConfig()).
  if (harness === "opencode" && jfrogMcpEntry(parsed) === null) {
    for (const layerPath of resolved.layerPaths || []) {
      let layerParsed;
      try {
        layerParsed = JSON.parse(readFileSync(layerPath, "utf8"));
      } catch {
        continue;
      }
      if (jfrogMcpEntry(layerParsed) !== null) {
        target = layerPath;
        parsed = layerParsed;
        break;
      }
    }
  }

  // Auto-substitute any ${JFROG_PLATFORM_URL}/${JFROG_URL} placeholder with
  // the real JPD URL — checked against the jfrog entry's own url, not the
  // raw file text, so an unrelated MCP entry can't trigger it.
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
      emit(status, target, `plugin mcp.json contains a JFROG_PLATFORM_URL placeholder and automatic substitution failed — ${fixerFailureDetail(result)}`);
      return status === "error" ? 3 : 1;
    }
    try {
      parsed = JSON.parse(readFileSync(target, "utf8"));
    } catch (err) {
      emit("error", target, `substitution succeeded but re-reading ${target} failed: ${err.message}`);
      return 3;
    }
  } else if (preSubstitutionUrl === null && harness === "opencode" && !process.env.JFROG_INIT_MCP_CONFIG) {
    // No mcp.jfrog entry at all — OpenCode's expected steady state until
    // /jfrog-init writes one, sourced from jf config.
    const result = writeOpencodeMcp(target, SERVER_ID);
    if (result.exitCode === 2) {
      emit("ask", target, result.detail, { unresolved: "server", candidates: result.candidates });
      return 2;
    }
    if (result.exitCode !== 0) {
      const status = result.status === "error" ? "error" : "red";
      emit(status, target, `OpenCode config has no mcp.jfrog entry and writing one failed — ${fixerFailureDetail(result)}`);
      return status === "error" ? 3 : 1;
    }
    try {
      parsed = JSON.parse(readFileSync(target, "utf8"));
    } catch (err) {
      emit("error", target, `write succeeded but re-reading ${target} failed: ${err.message}`);
      return 3;
    }
  }

  const url = jfrogMcpUrl(parsed);
  const hasUrl = typeof url === "string" && url.trim() !== "";
  if (!hasUrl) {
    const detail =
      harness === "opencode"
        ? "no usable mcp.jfrog url — add or fix the entry and re-run /jfrog-init"
        : "plugin mcp.json has no valid jfrog entry (missing or empty url) — reinstall or update the JFrog plugin";
    emit("red", target, detail);
    return 1;
  }

  const detail = harness === "opencode" ? "OpenCode config present with mcp.jfrog entry" : "plugin mcp.json present with a jfrog entry";
  emit("green", target, detail);
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = detectJfrogMcp(process.argv[2]);
}

