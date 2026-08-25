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
//   Codex:      $CODEX_HOME/plugins/cache/codex-plugin/jfrog/<version>/.mcp.json
//                 (multiple <version> dirs may exist; most-recently-modified
//                  wins. $CODEX_HOME defaults to ~/.codex.)
//
// NOTE (Claude): the current released Claude plugin (jfrog-beta/0.3.0-beta.1)
// does NOT ship a .mcp.json — the source repo has one, but the packager
// does not include it. Until the packager is fixed, resolution on Claude
// Code throws a "plugin file not installed" error, which the detector
// converts into a clear red / "reinstall the JFrog plugin" instruction.
//
// Harness detection (env-var signals, in order):
//   1. Codex        -> $CODEX_SANDBOX / $CODEX_THREAD_ID / $CODEX_CI set
//   2. Claude Code  -> $CLAUDECODE / $CLAUDE_CODE_* set
//   3. Cursor       -> $CURSOR_AGENT / $CURSOR_CLI / $CURSOR_TRACE_ID set,
//                      or TERM_PROGRAM=cursor
//   4. VS Code      -> $VSCODE_PID set, or TERM_PROGRAM=vscode
// Codex is listed first because a Codex session launched from inside
// another harness's terminal still carries that host's own signal — and
// nesting goes both ways, so more than one signal can be present at once.
// When that happens, detectHarness() below walks the process ancestry to
// find which harness actually spawned this invocation.
// detectHarness() is the single JS implementation — exported and reused
// by every other script in this skill that needs harness information.
//
// Overrides:
//   - JFROG_INIT_HARNESS=claude|cursor|vscode|codex  forces one specific harness.
//   - JFROG_INIT_MCP_CONFIG=/abs/path                forces one specific path.
//     (Escape hatch — bypasses the plugin-path resolution entirely.)
//   - CODEX_HOME=/abs/path                           Codex's own var, honored by
//     the codex branch below; defaults to ~/.codex.
//
// CLI usage: node jfrog-resolve-mcp-config.mjs
//   Prints only the path on stdout on success.
//   Exit 0 -> path resolved
//   Exit 1 -> could not detect the current harness
//   Exit 2 -> harness detected, but the plugin's mcp.json is not installed

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isMainModule } from "./lib/jf.mjs";

const VALID_HARNESSES = new Set(["claude", "cursor", "vscode", "codex"]);

// One entry per harness, in priority order (see doc comment above) — used
// both as the signal check and as the static fallback when the ancestry
// tie-break can't resolve it. Adding a harness (Kiro, OpenCode, ...) is
// just a new entry here.
const HARNESS_SIGNALS = [
  { name: "codex", signaled: () => process.env.CODEX_SANDBOX || process.env.CODEX_THREAD_ID || process.env.CODEX_CI },
  { name: "claude", signaled: () => process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT || process.env.CLAUDE_CODE_SESSION_ID },
  // Checked before VS Code: Cursor's CLI/agent surfaces can report TERM_PROGRAM=vscode.
  { name: "cursor", signaled: () => process.env.CURSOR_AGENT || process.env.CURSOR_CLI || process.env.CURSOR_TRACE_ID || process.env.TERM_PROGRAM === "cursor" },
  { name: "vscode", signaled: () => process.env.VSCODE_PID || process.env.TERM_PROGRAM === "vscode" },
];

// Breaks ties when multiple harness signals fire at once: env vars are
// inherited by child processes regardless of nesting direction, so
// presence alone can't tell them apart. Walks up from the immediate
// parent — skipping the shell/node layers each harness spawns to run a
// command (e.g. codex -> bash -> claude -> bash -> node) — until a
// process name matches a candidate, or maxDepth is hit. Unix-only (ps);
// returns [] on failure (e.g. Windows), which falls through to the
// static priority order.
function getAncestorChain(maxDepth = 12) {
  const chain = [];
  let pid = process.ppid;
  for (let i = 0; i < maxDepth && pid > 1; i++) {
    let line;
    try {
      line = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)]).toString().trim();
    } catch {
      break;
    }
    const match = line.match(/^(\d+)\s+(.*)$/);
    if (!match) break;
    chain.push(match[2].toLowerCase());
    pid = Number(match[1]);
  }
  return chain;
}

// JFROG_INIT_HARNESS is matched case-insensitively so the documented
// override doesn't silently fail on a case mismatch. getAncestors is
// injectable so tests can stub the tie-break without spawning `ps`.
export function detectHarness(getAncestors = getAncestorChain) {
  if (process.env.JFROG_INIT_HARNESS) return process.env.JFROG_INIT_HARNESS.trim().toLowerCase();
  const candidates = HARNESS_SIGNALS.filter((h) => h.signaled()).map((h) => h.name);
  if (candidates.length <= 1) return candidates[0] || "";
  // Multiple signals at once means nested harnesses — resolve via
  // ancestry, else fall back to the static priority order.
  for (const comm of getAncestors()) {
    const match = candidates.find((name) => comm.includes(name));
    if (match) return match;
  }
  return candidates[0];
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

function resolveClaudePath() {
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

function resolveCursorPath() {
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

function resolveVscodePath() {
  const p = join(homedir(), ".vscode", "agent-plugins", "github.com", "jfrog", "vscode-plugin", "plugin", ".mcp.json");
  if (!existsSync(p)) {
    return {
      error: `JFrog VS Code plugin's .mcp.json not found at ${p}\n       install the JFrog plugin in VS Code to make it available.`,
      code: 2,
    };
  }
  return { path: p };
}

function resolveCodexPath() {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  const codexPluginDir = join(codexHome, "plugins", "cache", "codex-plugin", "jfrog");
  const match = newestMatch(codexPluginDir, [".mcp.json"]);
  if (!match) {
    return {
      error:
        `JFrog Codex plugin's .mcp.json not found under ${codexPluginDir}/\n` +
        "       run `codex plugin marketplace add jfrog/codex-plugin` then\n" +
        "       `codex plugin add jfrog@codex-plugin` to make it available.",
      code: 2,
    };
  }
  return { path: match };
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
      error: `JFROG_INIT_HARNESS=${process.env.JFROG_INIT_HARNESS} is not one of: claude, cursor, vscode, codex.`,
      code: 1,
    };
  }

  switch (harness) {
    case "claude":
      return resolveClaudePath();
    case "cursor":
      return resolveCursorPath();
    case "vscode":
      return resolveVscodePath();
    case "codex":
      return resolveCodexPath();
    default:
      return {
        error:
          "could not detect current harness (Claude Code / Cursor / VS Code / Codex).\n" +
          "  Set JFROG_INIT_HARNESS=claude|cursor|vscode|codex, or\n" +
          "  JFROG_INIT_MCP_CONFIG=/absolute/path/to/mcp.json to override.",
        code: 1,
      };
  }
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
