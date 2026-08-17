#!/usr/bin/env node
// Resolves the PLUGIN-OWNED mcp.json for the CURRENT harness and returns its
// absolute path. This is the file the JFrog plugin ships with — NOT the
// user's project- or user-scope MCP config. This skill never touches the
// customer's own mcp.json; only the one owned by the JFrog plugin.
//
// Plugin-owned paths per harness:
//   Cursor:     ~/.cursor/plugins/cache/cursor-public/jfrog/<sha>/mcp.json
//                 (multiple <sha> dirs may exist; the most-recently-modified
//                  one is picked — that's the active version.)
//   VS Code:    ~/.vscode/agent-plugins/github.com/jfrog/vscode-plugin/plugin/.mcp.json
//                 (stable path; no sha in the path.)
//   Claude:     ~/.claude/plugins/cache/<marketplace>/jfrog/<version>/.mcp.json
//                 (glob across any marketplace + version; most-recently-
//                  modified wins.)
//
// NOTE (Claude): the current released Claude plugin (jfrog-beta/0.3.0-beta.1)
// does NOT ship a .mcp.json — the source repo has one, but the packager
// does not include it. Until the packager is fixed, resolution on Claude
// Code throws a "plugin file not installed" error, which the detector
// converts into a clear red / "reinstall the JFrog plugin" instruction.
//
// Harness detection (env-var signals, in order):
//   1. Claude Code  -> $CLAUDECODE / $CLAUDE_CODE_* set
//   2. Cursor       -> $CURSOR_AGENT / $CURSOR_CLI / $CURSOR_TRACE_ID set,
//                      or TERM_PROGRAM=cursor
//   3. VS Code      -> $VSCODE_PID set, or TERM_PROGRAM=vscode
// The Cursor signals mirror the base skill's check-environment.sh
// detect_harness() and harness-common.md's routing table.
//
// Overrides:
//   - JFROG_INIT_HARNESS=claude|cursor|vscode  forces one specific harness.
//   - JFROG_INIT_MCP_CONFIG=/abs/path          forces one specific path.
//     (Escape hatch — bypasses the plugin-path resolution entirely.)
//
// CLI usage: node jfrog-resolve-mcp-config.mjs
//   Prints only the path on stdout on success.
//   Exit 0 -> path resolved
//   Exit 1 -> could not detect the current harness
//   Exit 2 -> harness detected, but the plugin's mcp.json is not installed

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isMainModule } from "./lib/jf.mjs";

const VALID_HARNESSES = new Set(["claude", "cursor", "vscode"]);

// JFROG_INIT_HARNESS is matched case-insensitively (e.g. "Claude", "CURSOR")
// so the documented override doesn't silently fail on a case mismatch.
export function detectHarness() {
  if (process.env.JFROG_INIT_HARNESS) return process.env.JFROG_INIT_HARNESS.trim().toLowerCase();
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT || process.env.CLAUDE_CODE_SESSION_ID) return "claude";
  // CURSOR_AGENT / CURSOR_CLI are as much a Cursor signal as
  // CURSOR_TRACE_ID — all three are what the base skill's
  // check-environment.sh detect_harness() and harness-common.md's routing
  // table treat as Cursor, and this function has to agree with them or
  // the two disagree about which harness the same session is running in.
  // Order matters as much as the signals: Cursor's CLI/agent surfaces can
  // report TERM_PROGRAM=vscode, so the Cursor test has to run before the
  // VS Code one below or those surfaces resolve to the VS Code plugin
  // path and the detector reports the JFrog plugin as missing.
  if (process.env.CURSOR_AGENT || process.env.CURSOR_CLI || process.env.CURSOR_TRACE_ID || process.env.TERM_PROGRAM === "cursor") {
    return "cursor";
  }
  if (process.env.VSCODE_PID || process.env.TERM_PROGRAM === "vscode") return "vscode";
  return "";
}

// Picks the newest file matching `<dir>/*/<...tailParts>` by mtime.
function newestMatch(dir, tailParts) {
  let best = null;
  let bestMtime = -Infinity;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(dir, entry.name, ...tailParts);
    let mtime;
    try {
      mtime = statSync(candidate).mtimeMs;
    } catch {
      // Candidate existed during readdirSync but is gone now (e.g. a
      // plugin update replacing this version dir mid-scan) — skip it
      // rather than letting statSync's ENOENT crash the whole detector.
      continue;
    }
    if (mtime > bestMtime) {
      best = candidate;
      bestMtime = mtime;
    }
  }
  return best;
}

// Claude's cache nests one extra "marketplace" directory:
// ~/.claude/plugins/cache/<marketplace>/jfrog/<version>/.mcp.json — one
// newestMatch() per marketplace (over its jfrog/<version> dirs), then the
// newest across marketplaces. Delegating to newestMatch() rather than
// re-scanning by hand keeps this path's stale-entry handling (a version
// dir vanishing mid-scan) in sync with the Cursor/VS Code path for free.
function newestClaudeMatch() {
  const cacheDir = join(homedir(), ".claude", "plugins", "cache");
  let marketplaces;
  try {
    marketplaces = readdirSync(cacheDir, { withFileTypes: true });
  } catch {
    return null;
  }
  let best = null;
  let bestMtime = -Infinity;
  for (const mp of marketplaces) {
    if (!mp.isDirectory()) continue;
    const candidate = newestMatch(join(cacheDir, mp.name, "jfrog"), [".mcp.json"]);
    if (!candidate) continue;
    let mtime;
    try {
      mtime = statSync(candidate).mtimeMs;
    } catch {
      continue;
    }
    if (mtime > bestMtime) {
      best = candidate;
      bestMtime = mtime;
    }
  }
  return best;
}

export function resolveMcpConfig() {
  if (process.env.JFROG_INIT_MCP_CONFIG) {
    return { path: process.env.JFROG_INIT_MCP_CONFIG };
  }

  const harness = detectHarness();

  // An explicit override that doesn't match a known harness is a typo, not
  // "no signal detected" — say so instead of falling through to the
  // generic detection-failure message below, which would tell the user to
  // set the very variable they already set.
  if (process.env.JFROG_INIT_HARNESS && !VALID_HARNESSES.has(harness)) {
    return {
      error: `JFROG_INIT_HARNESS=${process.env.JFROG_INIT_HARNESS} is not one of: claude, cursor, vscode.`,
      code: 1,
    };
  }

  if (harness === "claude") {
    const match = newestClaudeMatch();
    if (!match) {
      return {
        error:
          "JFrog Claude plugin does not ship a .mcp.json at ~/.claude/plugins/cache/*/jfrog/*/.mcp.json\n" +
          "       reinstall or update the JFrog plugin so it includes the file.",
        code: 2,
      };
    }
    return { path: match };
  }

  if (harness === "cursor") {
    const match = newestMatch(join(homedir(), ".cursor", "plugins", "cache", "cursor-public", "jfrog"), ["mcp.json"]);
    if (!match) {
      return {
        error:
          "JFrog Cursor plugin's mcp.json not found under ~/.cursor/plugins/cache/cursor-public/jfrog/\n" +
          "       install the JFrog plugin in Cursor to make it available.",
        code: 2,
      };
    }
    return { path: match };
  }

  if (harness === "vscode") {
    const p = join(homedir(), ".vscode", "agent-plugins", "github.com", "jfrog", "vscode-plugin", "plugin", ".mcp.json");
    if (!existsSync(p)) {
      return {
        error: `JFrog VS Code plugin's .mcp.json not found at ${p}\n       install the JFrog plugin in VS Code to make it available.`,
        code: 2,
      };
    }
    return { path: p };
  }

  return {
    error:
      "could not detect current harness (Claude Code / Cursor / VS Code).\n" +
      "  Set JFROG_INIT_HARNESS=claude|cursor|vscode, or\n" +
      "  JFROG_INIT_MCP_CONFIG=/absolute/path/to/mcp.json to override.",
    code: 1,
  };
}

if (isMainModule(import.meta.url)) {
  const result = resolveMcpConfig();
  if (result.path) {
    process.stdout.write(result.path + "\n");
    process.exitCode = 0;
  } else {
    process.stderr.write(`error: ${result.error}\n`);
    process.exitCode = result.code;
  }
}
