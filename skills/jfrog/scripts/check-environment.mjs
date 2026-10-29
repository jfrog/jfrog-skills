#!/usr/bin/env node
// check-environment.mjs — Cached JFrog CLI environment check
//
// Cross-platform port of check-environment.sh (bash does not run natively on
// Windows). Checks if jf is installed and its version, using a 24h-TTL cache
// at ${JFROG_CLI_HOME_DIR:-<home>/.jfrog}/skills-cache/jfrog-skill-state.json
// to avoid redundant checks. The skills-cache/ dir holds only this file and
// the OneModel schema cache — not temp API output.
//
// Usage:
//   node check-environment.mjs [<model-slug>] [--force]
//
// stdout: bare JFROG_CLI_USER_AGENT value (one line) — agent captures it
//         and exports it once at the top of every shell invocation that
//         calls jf
// stderr: JSON state (informational, also written to cache file)
//
// Exit codes:
//   0 — cache fresh, CLI ready
//   1 — cache refreshed, CLI ready
//   2 — jf not installed
//   3 — jf below MIN_CLI_VERSION (required for `jf api`)
//   4 — Node below 18: nothing is run or cached; use check-environment.sh
//
// Env: JFROG_CLI_HOME_DIR            overrides the ~/.jfrog cache location
//      JFROG_SKILLS_RELEASES_URL     overrides the latest-version listing
//                                    (used by tests; default is the public
//                                    releases.jfrog.io listing)
//      HTTPS_PROXY / HTTP_PROXY / NO_PROXY
//                                    honored for the latest-version lookup
//                                    (http:// proxies; same as curl in the .sh)
//
// Requires Node.js 18+ (global fetch, AbortSignal.timeout, Object.hasOwn).

import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Before anything touches the cache: on Node < 18 there is no global fetch, so
// the latest-version lookup would fail and cache "unknown" for 24h, which then
// hides the upgrade offer from the .sh fallback too.
if (Number(process.versions.node.split(".")[0]) < 18) {
  process.stderr.write(
    `check-environment.mjs needs Node 18+ (found ${process.versions.node}); ` +
      "use bash check-environment.sh instead.\n",
  );
  process.exit(4);
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SKILL_ROOT = join(dirname(SCRIPT_PATH), "..");
const JFROG_HOME = process.env.JFROG_CLI_HOME_DIR || join(homedir(), ".jfrog");
const CACHE_DIR = join(JFROG_HOME, "skills-cache");
const CACHE_FILE = join(CACHE_DIR, "jfrog-skill-state.json");
const DEFAULT_TTL_HOURS = 24;
const RELEASES_URL =
  process.env.JFROG_SKILLS_RELEASES_URL ||
  "https://releases.jfrog.io/artifactory/jfrog-cli/v2-jf/";

// Minimum jf CLI version required by this skill. `jf api` (the generic
// authenticated REST pass-through used by nearly every reference in this
// skill) landed in 2.100.0; older CLIs fail with "unknown command: api".
const MIN_CLI_VERSION = "2.100.0";

// CLIs >= this version emit ai-agent/ + ai-client/ + ai-model/ (Client→Agent→Model
// via jfrog-cli-core #1602 + jfrog-cli #3645). Omit client= in the skill UA to
// avoid double-encoding. Always emit tool= — mcp-management Step A parses it from
// this script's stdout, which never includes the CLI's ai-agent/ token.
//
// MERGE / RELEASE PIN: tip `CliVersion` is still 2.119.0 while the identity code
// is already on master. Released 2.118/2.119 only appended ai-agent/. Keep this
// gate at the first *released* CLI that ships full Client→Agent→Model (expected
// 2.120.0). When that release cuts, confirm the tag and update this constant if
// the version number differs — do not lower it to tip's 2.119.0.
const AGENT_UA_MIN_CLI_VERSION = "2.120.0";

const SEMVER = /\d+\.\d+\.\d+/g;
const EXACT_SEMVER = /^\d+\.\d+\.\d+$/;
const env = (name) => process.env[name] ?? "";

// ---------------------------------------------------------------- versions

function parseVersion(v) {
  return v.split(".").map(Number);
}

// Plain X.Y.Z numeric comparison (`sort -V` in the bash original).
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

// True if `a` is strictly less than `b`. A non-semver side is never "less".
function versionLt(a, b) {
  if (!EXACT_SEMVER.test(a) || !EXACT_SEMVER.test(b)) return false;
  return compareVersions(a, b) < 0;
}

// ------------------------------------------------------------- jf resolution

// A pure-Node PATH scan (PATHEXT-aware on Windows) so no `which`/`where`
// binary is needed and no shell parses the lookup.
function resolveBinaryPath(command) {
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const names =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
          .map((ext) => command + ext.toLowerCase())
      : [command];
  for (const dir of dirs) {
    for (const name of names) {
      const full = join(dir, name);
      try {
        // Windows has no POSIX executable bit — F_OK is the best signal there.
        if (!statSync(full).isFile()) continue;
        accessSync(
          full,
          process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
        );
        return full;
      } catch {
        // Not in this PATH entry — keep looking.
      }
    }
  }
  return "";
}

// First X.Y.Z printed by `jf --version`, or "unknown". Node refuses to spawn a
// Windows `.cmd` shim (the npm-installed jf) without a shell, so that one case
// goes through cmd.exe with the path quoted; the only argument is a constant.
function jfVersion(jfPath) {
  const viaShell = /\.(cmd|bat)$/i.test(jfPath);
  const prevNoDeprecation = process.noDeprecation;
  process.noDeprecation = true;
  let result;
  try {
    result = spawnSync(viaShell ? `"${jfPath}"` : jfPath, ["--version"], {
      encoding: "utf8",
      timeout: 15_000,
      shell: viaShell,
    });
  } finally {
    process.noDeprecation = prevNoDeprecation;
  }
  const match = `${result.stdout || ""}`.match(SEMVER);
  return match ? match[0] : "unknown";
}

// ------------------------------------------------------------------ cache

// The text of the last cache read, so the fresh path can echo exactly what it
// parsed instead of reading the file a second time (it can vanish in between).
let cacheText = "";

function readCache() {
  try {
    cacheText = readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(cacheText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function isCacheFresh(cache) {
  if (!cache || !cache.checked_at) return false;
  const checkedMs = Date.parse(cache.checked_at);
  if (Number.isNaN(checkedMs)) return false;
  const ttlHours = cache.ttl_hours ?? DEFAULT_TTL_HOURS;
  if (typeof ttlHours !== "number" || !Number.isFinite(ttlHours)) return false;
  const ageSeconds =
    Math.floor(Date.now() / 1000) - Math.floor(checkedMs / 1000);
  return ageSeconds < ttlHours * 3600;
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

// Atomic: write a sibling temp file, then rename over the cache. Best-effort:
// an unwritable cache (read-only dir, full disk, a file locked on Windows) only
// costs the next run a refresh, so it must not change the exit code or lose the UA.
function writeCache(state) {
  const tmp = join(CACHE_DIR, `.jfrog-skill-state.${process.pid}.tmp`);
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(tmp, CACHE_FILE);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Nothing more to clean up.
    }
  }
}

function emitMinVersionError(version) {
  process.stderr.write(
    `${JSON.stringify({
      error: `jf CLI ${version} is below minimum ${MIN_CLI_VERSION} required by this skill (needed for 'jf api'). See references/jfrog-cli-install-upgrade.md.`,
    })}\n`,
  );
}

// ------------------------------------------------------------ latest version

// Node's fetch ignores HTTPS_PROXY/HTTP_PROXY/NO_PROXY, which curl in the .sh
// honors. So behind a proxy the lookup goes through it the way curl does: an
// absolute-URI request for http targets, a CONNECT tunnel for https. Plain
// http:// proxies only (no socks, PAC or NTLM); anything else goes direct.
function bypassesProxy(target, noProxy) {
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const port = target.port || (target.protocol === "https:" ? "443" : "80");
  return noProxy.split(",").some((entry) => {
    const [name, entryPort] = entry
      .trim()
      .toLowerCase()
      .split(/:(?=\d+$)/);
    if (!name || (entryPort && entryPort !== port)) return false;
    if (name === "*") return true;
    const suffix = name.replace(/^\*?\./, "");
    return host === suffix || host.endsWith(`.${suffix}`);
  });
}

function proxyFor(target) {
  const env = process.env;
  const raw =
    target.protocol === "https:"
      ? env.https_proxy || env.HTTPS_PROXY
      : env.http_proxy || env.HTTP_PROXY;
  if (!raw || bypassesProxy(target, env.no_proxy || env.NO_PROXY || "")) {
    return null;
  }
  try {
    const proxy = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return proxy.protocol === "http:" ? proxy : null;
  } catch {
    return null;
  }
}

function getViaProxy(target, proxy, signal) {
  return new Promise((resolve, reject) => {
    const headers = { Host: target.host };
    if (proxy.username) {
      const login = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
      headers["Proxy-Authorization"] =
        `Basic ${Buffer.from(login).toString("base64")}`;
    }
    const send = (req) => {
      req.on("error", reject);
      req.on("response", (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      });
      req.end();
    };
    const viaProxy = {
      host: proxy.hostname.replace(/^\[|\]$/g, ""),
      port: proxy.port || 80,
      signal,
    };
    if (target.protocol === "http:") {
      send(httpRequest({ ...viaProxy, path: target.href, headers }));
      return;
    }
    const tunnel = httpRequest({
      ...viaProxy,
      method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`,
      headers,
    });
    tunnel.on("error", reject);
    tunnel.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy answered CONNECT with ${res.statusCode}`));
        return;
      }
      send(
        httpsRequest({
          host: target.hostname,
          servername: target.hostname,
          path: `${target.pathname}${target.search}`,
          socket,
          agent: false,
          signal,
        }),
      );
    });
    tunnel.end();
  });
}

// Best-effort and non-blocking: any failure is "unknown".
async function fetchLatestVersion() {
  try {
    const signal = AbortSignal.timeout(5000);
    const target = new URL(RELEASES_URL);
    const proxy = proxyFor(target);
    const res = proxy
      ? await getViaProxy(target, proxy, signal)
      : await fetch(target, { signal }).then(async (direct) => ({
          ok: direct.ok,
          body: await direct.text(),
        }));
    if (!res.ok) return "unknown";
    const found = res.body.match(SEMVER) || [];
    if (found.length === 0) return "unknown";
    return found.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
  } catch {
    return "unknown";
  }
}

// Offer once per new latest. suggest_upgrade is tri-state:
//   true  — pending offer
//   false — already offered (or not behind); --clear writes false
//   missing / non-semver prev latest — never evaluated → set true when behind
function decideSuggestUpgrade({ cliVersion, latestVersion, prev }) {
  const prevLatest = EXACT_SEMVER.test(prev?.latest_version_available ?? "")
    ? prev.latest_version_available
    : "";
  const prevFlag =
    prev?.suggest_upgrade === true
      ? "true"
      : prev?.suggest_upgrade === false
        ? "false"
        : "";
  let latest = latestVersion;
  let suggest = prevFlag === "true";
  if (!EXACT_SEMVER.test(latest)) {
    if (prevLatest) latest = prevLatest;
    else suggest = false;
  }
  if (EXACT_SEMVER.test(latest) && versionLt(cliVersion, latest)) {
    if (!prevLatest || prevLatest !== latest) suggest = true;
    else suggest = prevFlag !== "false";
  } else if (EXACT_SEMVER.test(latest)) {
    suggest = false;
  }
  return { latest, suggest };
}

// ---------------------------------------------------------- UA computation

// Lowercase and keep only [a-z0-9._-], then truncate to 64 chars — mirrors the
// Go CLI sanitizeToken (cardinality bound + no header-splitting on the wire).
function sanitizeToken(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 64);
}

// A VS Code-fork askpass path is that editor's install, not an unrelated
// substring (a Windows login named "cursor" would otherwise match).
// GIT_ASKPASS is generic git and is excluded. Mirrors jfrog-cli-core
// askpassPathContains.
function askpassValues() {
  return ["VSCODE_GIT_ASKPASS_MAIN", "VSCODE_GIT_ASKPASS_NODE"]
    .map((key) => env(key).toLowerCase().replaceAll("\\", "/"))
    .filter(Boolean);
}

function askpassPathContains(app) {
  return askpassValues().some(
    (p) =>
      p.includes(`/${app}.app`) ||
      p.includes(`/${app}/resources`) ||
      p.includes(`/.${app}-server`),
  );
}

// Positive upstream VS Code install only. A non-empty VSCODE_GIT_ASKPASS_* var
// is not enough — every fork sets those.
function askpassLooksLikeStockVscode() {
  return askpassValues().some(
    (p) =>
      p.includes("/visual studio code") ||
      p.includes("/microsoft vs code") ||
      p.includes("/.vscode-server") ||
      p.includes("/code/resources"),
  );
}

// Short product names for known terminals. Unmapped values (including inherited
// TERM_PROGRAM=vscode) stay empty so client stays on the known-app allowlist.
const TERMINALS = {
  iterm: "iterm",
  apple_terminal: "terminal",
  warpterminal: "warp",
  warp: "warp",
  tmux: "tmux",
  wezterm: "wezterm",
  alacritty: "alacritty",
  kitty: "kitty",
  ghostty: "ghostty",
  hyper: "hyper",
};

function canonicalTerminalName(raw) {
  let name = sanitizeToken(raw);
  if (name === "iterm.app") return "iterm";
  if (name.endsWith(".app")) name = name.slice(0, -".app".length);
  // hasOwn: "constructor" / "__proto__" must not resolve through the prototype.
  return Object.hasOwn(TERMINALS, name) ? TERMINALS[name] : "";
}

function fallbackTerminalName() {
  if (env("TMUX")) return "tmux";
  if (env("WT_SESSION")) return "windows-terminal";
  if (env("TERM") === "xterm-ghostty") return "ghostty";
  if (env("KITTY_WINDOW_ID")) return "kitty";
  if (env("ALACRITTY_LOG")) return "alacritty";
  return "";
}

function hostTerminalName() {
  return canonicalTerminalName(env("TERM_PROGRAM")) || fallbackTerminalName();
}

function foldAgentName(raw) {
  return String(raw).trim().toLowerCase().split("@")[0];
}

function isCopilotVscodePluginAlias() {
  return (
    foldAgentName(env("AI_AGENT")) === "github_copilot_vscode_agent" ||
    foldAgentName(env("AGENT")) === "github_copilot_vscode_agent"
  );
}

// The app hosting this session. Mirrors detectClient() in
// jfrog-cli-core/common/commands/execution_context.go — keep the two in sync.
//
// Deliberately NOT part of detectHarness(): that table drives Agent Guard
// routing and mcp-management's tool= parsing and stays frozen. This only feeds
// the client= key.
//
// Order matters: every VS Code fork inherits the VSCODE_* vars from upstream, so
// a fork must resolve before anything reports vscode. CURSOR_AGENT does not
// prove the window (standalone CLI in iTerm / CI).
function detectHostClient() {
  if (env("ZED_TERM")) return "zed";
  if (env("TERMINAL_EMULATOR") === "JetBrains-JediTerm") return "jetbrains";
  if (env("CURSOR_TRACE_ID") || askpassPathContains("cursor")) return "cursor";
  if (env("WINDSURF_CASCADE_TERMINAL") || askpassPathContains("windsurf"))
    return "windsurf";
  if (env("ANTIGRAVITY_AGENT") || askpassPathContains("antigravity"))
    return "antigravity";
  if (env("TRAE_AI_SHELL_ID") || askpassPathContains("trae")) return "trae";
  if (askpassPathContains("vscodium") || askpassPathContains("codium"))
    return "codium";
  if (env("VisualStudioVersion")) return "visualstudio";
  if (askpassLooksLikeStockVscode()) return "vscode";
  if (env("COPILOT_AGENT") === "1" || isCopilotVscodePluginAlias()) {
    return hostTerminalName() || "vscode";
  }
  if (env("CLAUDE_CODE_CHILD_SESSION") || env("CLAUDE_CODE_IS_COWORK"))
    return "claude";
  return hostTerminalName();
}

// Map a generic AI_AGENT/AGENT value (agents.md proposal, @vercel/detect-agent)
// to a canonical name. Strips a version suffix (e.g. "goose@1.2.3") and lowercases.
// Empty input → empty; unrecognized non-empty → "unknown".
// Accepts both hyphenated ecosystem ids and our underscore/canonical forms so
// AI_AGENT=roo_code / amazon_q / qwen round-trip the same as the Go CLI.
const AGENT_ALIASES = {
  "claude-code": "claude",
  claude: "claude",
  "gemini-cli": "gemini",
  gemini: "gemini",
  goose: "goose",
  "cursor-cli": "cursor",
  cursor: "cursor",
  "github-copilot": "copilot",
  "copilot-cli": "copilot",
  copilot: "copilot",
  github_copilot_vscode_agent: "copilot",
  kilocode: "kilocode",
  "roo-code": "roo_code",
  roo_code: "roo_code",
  codex: "codex",
  windsurf: "windsurf",
  aider: "aider",
  cline: "cline",
  opencode: "opencode",
  "opencode-jfrog-plugin": "opencode",
  amp: "amp",
  augment: "augment",
  "qwen-code": "qwen",
  qwen: "qwen",
  antigravity: "antigravity",
  crush: "crush",
  iflow: "iflow",
  trae: "trae",
  "amazon-q-cli": "amazon_q",
  "amazon-q": "amazon_q",
  amazon_q: "amazon_q",
  junie: "junie",
};

function canonicalAgentName(input) {
  const raw = foldAgentName(input);
  if (raw === "") return "";
  return Object.hasOwn(AGENT_ALIASES, raw) ? AGENT_ALIASES[raw] : "unknown";
}

// Detect the calling harness from environment signals. First-match order matches
// the JFrog CLI's DetectExecutionContext() table (claude, gemini, goose, cursor,
// …) plus v0.22.0 product envs so mcp-management Step A still sees tool=claude /
// tool=cursor in Claude Code / Cursor IDE terminals (CLAUDECODE, CURSOR_TRACE_ID).
// Those product envs are also set for humans; real agent skill usage is the
// model= slug. Devin Desktop is not detected here — see harness-common.md.
// MODEL_SLUG→unknown fallback is applied by emitSkillEnv (not here).
function detectHarness() {
  const any = (...names) => names.some((name) => env(name));
  if (any("CLAUDE_CODE_CHILD_SESSION", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"))
    return "claude";
  if (any("GEMINI_CLI")) return "gemini";
  if (any("GOOSE_TERMINAL")) return "goose";
  if (
    any("CURSOR_AGENT", "CURSOR_CLI", "CURSOR_TRACE_ID") ||
    env("CURSOR_EXTENSION_HOST_ROLE") === "agent-exec"
  ) {
    return "cursor";
  }
  if (any("COPILOT_CLI", "COPILOT_AGENT_SESSION_ID", "COPILOT_AGENT"))
    return "copilot";
  if (any("KILOCODE_FEATURE", "KILO_PID")) return "kilocode";
  if (any("ROO_ACTIVE", "ROO_CLI_RUNTIME")) return "roo_code";
  if (any("CODEX_CI", "CODEX_THREAD_ID", "CODEX_SANDBOX")) return "codex";
  if (any("WINDSURF_CASCADE_TERMINAL")) return "windsurf";
  if (any("CLINE_ACTIVE")) return "cline";
  if (any("OPENCODE", "OPENCODE_SESSION_ID")) return "opencode";
  if (any("AMP_CURRENT_THREAD_ID")) return "amp";
  if (any("AUGMENT_AGENT")) return "augment";
  if (any("QWEN_CODE")) return "qwen";
  if (any("ANTIGRAVITY_AGENT")) return "antigravity";
  if (any("CRUSH")) return "crush";
  if (any("IFLOW_CLI")) return "iflow";
  if (any("TRAE_AI_SHELL_ID")) return "trae";
  // Junie (JetBrains): JUNIE_* env or a ~/.junie/ install; earlier real-agent checks win first.
  if (
    any("JUNIE_DATA", "JUNIE_SHIM_PATH") ||
    // import.meta.url is the real path; argv[1] keeps a symlinked
    // ~/.junie/skills/... spelling, which is how skills are installed.
    [SCRIPT_PATH, process.argv[1] ?? ""].some((path) =>
      path.replaceAll("\\", "/").includes("/.junie/"),
    )
  ) {
    return "junie";
  }
  // aider and amazon_q have no reliable session env — AI_AGENT / AGENT only.
  if (any("AI_AGENT", "AGENT"))
    return canonicalAgentName(env("AI_AGENT") || env("AGENT"));
  // No match → empty; the emitter may still apply MODEL_SLUG→unknown.
  return "";
}

// Version from SKILL.md YAML frontmatter (metadata.version), or "unknown".
function skillVersion() {
  try {
    let fences = 0;
    for (const line of readFileSync(join(SKILL_ROOT, "SKILL.md"), "utf8").split(
      /\r?\n/,
    )) {
      if (line === "---") {
        fences++;
        continue;
      }
      if (fences === 1 && /^\s*version:/.test(line)) {
        const value = line.trim().split(/\s+/)[1]?.replace(/["']/g, "").trim();
        return value || "unknown";
      }
      if (fences > 1) break;
    }
  } catch {
    // SKILL.md unreadable — fall through.
  }
  return "unknown";
}

// The UA line (stdout) for the skill path.
function buildUserAgent({ modelSlugArg, jfPath }) {
  // Prefer a live `jf --version` so the AGENT_UA_MIN omit-gate is not stuck on a
  // stale cache for up to 24h after the user upgrades the CLI.
  let cliVersion = jfPath ? jfVersion(jfPath) : "unknown";
  if (cliVersion === "unknown")
    cliVersion = readCache()?.cli_version || "unknown";
  // Sanitize the model slug once so the MODEL_SLUG→unknown fallback and the
  // wire model= key share the same cardinality-bounded, header-safe value
  // (mirrors the CLI's sanitizeToken on JFROG_CLI_AI_MODEL).
  const modelSlug = sanitizeToken(modelSlugArg);
  let harness = detectHarness();
  // Defense: re-canonicalize so alias wire values (e.g. claude-code from a
  // hand-built AI_AGENT / future detector slip) never reach tool=. Empty stays
  // empty; known aliases map; unrecognized non-empty → unknown.
  if (harness) harness = canonicalAgentName(harness) || harness;
  // Agent invoked us (passed a model slug) but set no harness signal the CLI
  // shares — CLI will not emit ai-agent/, so the skill must still carry tool=.
  let harnessFromModelFallback = false;
  if (!harness && modelSlug) {
    harness = "unknown";
    harnessFromModelFallback = true;
  }
  // Client: the editor window hosting the session (see detectHostClient).
  // Omitted on new CLI when the CLI will emit ai-client/ itself (not on the
  // model-slug fallback path).
  const client = detectHostClient();
  const carryClientUa =
    cliVersion === "unknown" ||
    versionLt(cliVersion, AGENT_UA_MIN_CLI_VERSION) ||
    harnessFromModelFallback;
  // trigger=skill always leads — this script only runs on the skill path.
  // (APR agent-hooks set trigger=hook when they spawn jf; see eager-setup.)
  // tool= is always emitted when known: mcp-management parses this stdout line
  // and never sees the CLI's later ai-agent/ token.
  let meta = "trigger=skill";
  if (harness) meta += `; tool=${harness}`;
  if (carryClientUa && harness && client) meta += `; client=${client}`;
  // model= is emitted regardless of CLI version (not deduped like tool=/client=):
  // the CLI's own ai-model/ token is conditional on it detecting the agent via
  // env AND the caller exporting JFROG_CLI_AI_MODEL, so the skill can't know
  // whether the CLI will carry it. Keeping model= here guarantees the slug is
  // always recorded; Coralogix coalesces the two sources so it isn't counted twice.
  if (modelSlug) meta += `; model=${modelSlug}`;
  return `jfrog-skills/${skillVersion()} (${meta}) jfrog-cli-go/${cliVersion}`;
}

// -------------------------------------------------------------------- main

async function main(argv) {
  let force = false;
  let modelSlugArg = "";
  for (const arg of argv) {
    if (arg === "--force") force = true;
    else if (!modelSlugArg) modelSlugArg = arg;
  }

  const cache = readCache();
  if (!force && isCacheFresh(cache)) {
    process.stderr.write(cacheText);
    // Re-evaluate the minimum on every run so a bumped MIN_CLI_VERSION
    // is enforced without waiting for the 24h cache to expire.
    const cachedVersion = cache.cli_version || "unknown";
    if (versionLt(cachedVersion, MIN_CLI_VERSION)) {
      emitMinVersionError(cachedVersion);
      return 3;
    }
    const jfPath = resolveBinaryPath("jf");
    process.stdout.write(`${buildUserAgent({ modelSlugArg, jfPath })}\n`);
    return 0;
  }

  const jfPath = resolveBinaryPath("jf");
  if (!jfPath) {
    process.stderr.write('{"cli_installed": false}\n');
    return 2;
  }

  const cliVersion = jfVersion(jfPath);
  const meetsMinimum =
    cliVersion !== "unknown" && !versionLt(cliVersion, MIN_CLI_VERSION);
  const { latest, suggest } = decideSuggestUpgrade({
    cliVersion,
    latestVersion: await fetchLatestVersion(),
    prev: cache,
  });
  const state = {
    checked_at: isoNow(),
    ttl_hours: DEFAULT_TTL_HOURS,
    cli_installed: true,
    cli_path: jfPath,
    cli_version: cliVersion,
    minimum_version: MIN_CLI_VERSION,
    meets_minimum_version: meetsMinimum,
    latest_version_available: latest,
    suggest_upgrade: suggest,
  };
  writeCache(state);
  process.stderr.write(`${JSON.stringify(state, null, 2)}\n`);

  if (cliVersion !== "unknown" && versionLt(cliVersion, MIN_CLI_VERSION)) {
    emitMinVersionError(cliVersion);
    return 3;
  }
  process.stdout.write(`${buildUserAgent({ modelSlugArg, jfPath })}\n`);
  return 1;
}

process.exitCode = await main(process.argv.slice(2));
