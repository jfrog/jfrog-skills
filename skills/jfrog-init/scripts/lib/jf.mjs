// jf.mjs — shared helpers for invoking `jf` and reading its config.
// Every detector needs the same three things: `jf` findable on PATH,
// its config read without ever touching a token on disk, and the JPD
// URL normalized to its root. Centralizing them here is what let the
// individual jfrog-detect-*.mjs scripts drop the ~30 lines of PATH/curl/base64
// boilerplate each `.sh` predecessor repeated.

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { prependToPathIfMissing, resolveCommand } from "./command.mjs";

export const JF_BIN_DIR = join(homedir(), ".jfrog", "bin");
const JF_BIN = join(JF_BIN_DIR, process.platform === "win32" ? "jf.exe" : "jf");

// `import.meta.url === pathToFileURL(process.argv[1]).href` looks right for
// the standard ESM "was I run directly?" check, but Node's ESM loader
// resolves symlinks when computing import.meta.url while pathToFileURL(argv[1])
// does not — so the comparison silently fails whenever the invoking path
// passes through a symlink (exactly how this skill is installed locally, via
// dev/dev-symlinks.sh). Resolving both sides through realpathSync fixes it.
export function isMainModule(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(moduleUrl) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

// Makes `jf` findable even when the current process's PATH doesn't
// include ~/.jfrog/bin — a fixed-location fallback for any `jf` install
// that landed there by some other means (e.g. a leftover from before this
// skill switched to npm, or a manual install following JFrog's own curl
// docs). jfrog-install-jf-cli.mjs itself never writes there or edits PATH.
export function selfHealPath() {
  if (existsSync(JF_BIN)) prependToPathIfMissing(JF_BIN_DIR);
}

// Does NOT export JFROG_CLI_USER_AGENT, unlike the base `jfrog` skill's
// documented "session-global invariant" (see SKILL.md's Prerequisites).
// That skill's scripts/check-environment.mjs — the only thing that
// produces the UA string — is now pure Node too, but it still only emits
// a UA once `jf` is ALREADY installed at its minimum version. This
// skill's early steps exist specifically to get `jf` installed in the
// first place, before that precondition holds — calling it here would
// hit that same-version gate, not a scripting-language mismatch (the
// original reason this skill didn't reuse it, back when it was still a
// `jq`-dependent, GNU/BSD-`date`-branching `.sh` script). Telemetry-only
// impact (not functional correctness): `jf` calls from here just go
// unattributed in JFrog's own usage analytics.
// The default for runJf()'s local/fast operations (--version, config
// show/export) — without one, a wedged binary hangs the whole walk with
// no recovery, unlike every network call in this file (all of which use
// AbortSignal.timeout or an explicit timeout already). jfrog-detect-server-ping.mjs's
// own `jf rt ping` call (genuinely network-bound) overrides this via
// runJf()'s `timeoutMs` option instead of using this default. Matches
// jf rt ping's own 30s rather than a shorter value — `jf config
// export`/`config show` can trigger an OS credential-store prompt (e.g.
// macOS Keychain access confirmation) that the user takes a few seconds
// to notice and click, and a too-short timeout would kill that valid,
// still-in-progress prompt and misreport working credentials as broken.
export const JF_CLI_TIMEOUT_MS = 30_000;

// The one place every `jf` spawn goes through. `timeoutMs` overrides the
// local-operation default for a network-bound caller.
export function runJf(args, { timeoutMs = JF_CLI_TIMEOUT_MS } = {}) {
  selfHealPath();
  const { target, shell } = resolveCommand("jf");
  // Under `shell: true`, cmd.exe would read a metacharacter as a separator.
  if (shell) {
    const unsafe = args.find((a) => /[&|;$<>`"'\\\n]/.test(a));
    if (unsafe !== undefined) {
      throw new Error(`runJf: refusing shell-unsafe argument: ${JSON.stringify(unsafe)}`);
    }
  }
  // Without this, execFileSync forwards jf's stderr to ours.
  return execFileSync(target, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    shell,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// ---- in-process memoization ----
// jfAvailable() / jfConfigShow() / jfConfigExportResult() are each called
// independently by multiple detectors (jfrog-resolve-jf-server.mjs's
// resolveServerOrEmit(), jfrog-detect-project.mjs,
// jfrog-detect-catalog-runtime.mjs) — when jfrog-detect-all.mjs runs all
// of them in-process for one walk, that's several redundant `jf`
// subprocess spawns, and for jfConfigExportResult specifically, redundant OS
// credential-store prompts (e.g. a second macOS Keychain confirmation),
// for data that cannot change mid-walk: none of these read-only scripts
// ever mutate jf's install state or its config. Memoized here, at the one
// shared module every caller already imports through, rather than
// duplicated in each caller.
//
// jfrog-install-jf-cli.mjs is the one exception — it deliberately
// installs/updates `jf` and must see the result of that within the same
// process, so it calls invalidateJfAvailableCache() right after each
// install step that could have changed the answer.
let jfAvailableCache;
// "missing" (ENOENT — not on PATH) vs "broken" (on PATH but hung/timed out
// or otherwise failed to run) — same distinction jfrog-detect-jf-cli.mjs
// makes for its own direct check. Callers that only need jfAvailable()'s
// boolean were previously reporting a hung/corrupted `jf` as "not
// installed", which sends the user to reinstall from scratch instead of
// just reinstalling the existing (corrupted) binary.
let jfUnavailableReason;
let jfConfigShowCache;
const jfConfigExportCache = new Map();

export function jfAvailable() {
  if (jfAvailableCache === undefined) {
    selfHealPath();
    try {
      runJf(["--version"]);
      jfAvailableCache = true;
      jfUnavailableReason = undefined;
    } catch (err) {
      jfAvailableCache = false;
      jfUnavailableReason = err && err.code === "ENOENT" ? "missing" : "broken";
    }
  }
  return jfAvailableCache;
}

// For callers that gate on jfAvailable() and need a user-facing detail
// string for the false case — routes "broken" to the same reinstall
// wording jfrog-detect-jf-cli.mjs uses instead of misreporting a
// hung/corrupted binary as simply missing. Only meaningful after
// jfAvailable() has run at least once, which every caller already does to
// get the boolean itself.
export function describeJfUnavailable() {
  return jfUnavailableReason === "broken"
    ? "jf is on PATH but did not respond in time or failed to run (may be corrupted or hung) — reinstalling should fix this."
    : "jf not installed";
}

export function invalidateJfAvailableCache() {
  jfAvailableCache = undefined;
  jfUnavailableReason = undefined;
}

// Lets jfrog-detect-jf-cli.mjs's detectJfCli() — which needs its own
// `jf --version` call anyway to capture the version string for its
// `detail` field, with its own richer missing/broken/timed-out
// distinction — hand its already-obtained result to this cache instead
// of jfAvailable() spawning a second, independent `jf --version` later
// in the same walk. Without this, detectJfCli() and the first later
// jfAvailable() call (e.g. from jfrog-detect-jf-config.mjs) each spawn
// `jf` separately; if `jf` is flaky, the two calls can disagree and
// report self-contradictory green/red status for the same binary in one
// walk. A no-op once jfAvailable() has already populated the cache
// itself.
export function seedJfAvailable(available, reason) {
  if (jfAvailableCache !== undefined) return;
  jfAvailableCache = available;
  jfUnavailableReason = available ? undefined : reason;
}

export function jfConfigShow() {
  if (jfConfigShowCache === undefined) {
    try {
      const out = runJf(["config", "show", "--format=json"]);
      const parsed = JSON.parse(out);
      jfConfigShowCache = Array.isArray(parsed) ? parsed : [];
    } catch {
      jfConfigShowCache = [];
    }
  }
  return jfConfigShowCache;
}

// A server's config from `jf config export`, or null. `timedOut` tells a
// wedged `jf` from an unconfigured one.
export function jfConfigExportResult(serverId) {
  const cacheKey = serverId || "";
  if (!jfConfigExportCache.has(cacheKey)) {
    const result = { cfg: null, timedOut: false };
    try {
      const args = ["config", "export"];
      if (serverId) args.push(serverId);
      const lines = runJf(args).split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length) result.cfg = JSON.parse(Buffer.from(lines[lines.length - 1], "base64").toString("utf8"));
    } catch (err) {
      result.timedOut = err.code === "ETIMEDOUT";
    }
    jfConfigExportCache.set(cacheKey, result);
  }
  return jfConfigExportCache.get(cacheKey);
}

const HTTP_SCHEME = /^https?:\/\//i;

export function normalizeJpdUrl(url) {
  if (!url) return "";
  let u = url.replace(/\/+$/, "");
  // Strip trailing /artifactory and /ui repeatedly — a URL can end in
  // both (e.g. ".../artifactory/ui"), and a single non-repeated pass
  // would leave the other suffix in place.
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const suffix of ["/artifactory", "/ui"]) {
      if (u.endsWith(suffix)) {
        u = u.slice(0, -suffix.length);
        stripped = true;
      }
    }
  }
  if (!HTTP_SCHEME.test(u)) u = `https://${u}`;
  return u;
}

// A configured JPD URL, parsed, or null.
export function parseJpdUrl(raw) {
  if (!HTTP_SCHEME.test(raw)) return null;
  try {
    return new URL(normalizeJpdUrl(raw));
  } catch {
    return null;
  }
}

// Resolves URL + credentials (bearer token, falling back to user+password)
// for a server from `jf config export`. Returns null if nothing usable is
// configured. Credentials only ever live in the returned object for the
// duration of the caller's fetch — never logged, never written to disk.
export function resolveCreds(serverId) {
  const { cfg } = jfConfigExportResult(serverId);
  if (!cfg) return null;
  // Same url/artifactoryUrl naming ambiguity urlForServer() falls back on
  // for `jf config show` — `jf config export`'s JSON isn't guaranteed to
  // use the same field name across jf CLI versions.
  const rawUrl = (typeof cfg.url === "string" && cfg.url) || (typeof cfg.artifactoryUrl === "string" && cfg.artifactoryUrl) || "";
  const baseUrl = normalizeJpdUrl(rawUrl);
  const token = typeof cfg.accessToken === "string" ? cfg.accessToken : "";
  const user = typeof cfg.user === "string" ? cfg.user : "";
  const password = typeof cfg.password === "string" ? cfg.password : "";
  if (!baseUrl || (!token && !(user && password))) return null;
  return { baseUrl, token, user, password };
}

// The username behind a server's token, from a subject like
// "jfac@<jpd>/users/<name>". Empty when unavailable.
export function tokenUsername(serverId = "") {
  const args = ["api"];
  if (serverId) args.push(`--server-id=${serverId}`);
  args.push("/access/api/v1/tokens/me");
  try {
    const { subject = "" } = JSON.parse(runJf(args).trim() || "{}");
    return /\/users\/([^/]+)$/.exec(subject)?.[1] || "";
  } catch {
    return "";
  }
}

export function authHeader(creds) {
  if (creds.token) return { Authorization: `Bearer ${creds.token}` };
  return { Authorization: `Basic ${Buffer.from(`${creds.user}:${creds.password}`).toString("base64")}` };
}

const AUTHED_FETCH_TIMEOUT_MS = 15_000;
// A same-origin chain (e.g. an http->https upgrade followed by a reverse
// proxy's canonical-host redirect) can span more than one hop — bounded
// here rather than looped forever in case of a same-origin redirect cycle.
const MAX_SAME_ORIGIN_REDIRECTS = 5;

// Authenticated GET against `${creds.baseUrl}${path}`, shared by every
// detector that hits a JPD REST endpoint. Body is parsed as JSON when
// possible (null if the response isn't JSON or has no body); code 0
// means the request itself failed (connection error, timeout, etc).
export async function authedFetch(creds, path) {
  try {
    const headers = { Accept: "application/json", ...authHeader(creds) };
    let url = `${creds.baseUrl}${path}`;
    let res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(AUTHED_FETCH_TIMEOUT_MS),
      // Manual redirect handling: a 3xx to a DIFFERENT origin (e.g. a
      // captive portal or an unrelated login page) must surface as its
      // real status code, not be silently followed to a page that then
      // answers 200 for something that was never the JPD endpoint we
      // asked for. A same-origin 3xx (e.g. the JPD's own reverse proxy
      // normalizing http->https) is followed below instead, since that's
      // still the same server answering — see the follow-up loop.
      redirect: "manual",
    });
    for (let hop = 0; hop < MAX_SAME_ORIGIN_REDIRECTS && res.status >= 300 && res.status < 400; hop++) {
      const location = res.headers.get("location");
      if (!location) break;
      const current = new URL(url);
      const target = new URL(location, url);
      // URL.origin includes the scheme, so a plain same-origin check would
      // treat a same-host http->https upgrade as cross-origin and refuse to
      // follow it — exactly the case this loop exists for. The check must
      // still be asymmetric: same host AND port, with the scheme either
      // unchanged or upgrading to https. A same-host https->http redirect is
      // never followed — that would replay the Authorization header over
      // plaintext.
      const sameHostPort = target.hostname === current.hostname && target.port === current.port;
      const schemeOk = target.protocol === current.protocol || target.protocol === "https:";
      if (!sameHostPort || !schemeOk) break;
      url = target.href;
      res = await fetch(url, { headers, signal: AbortSignal.timeout(AUTHED_FETCH_TIMEOUT_MS), redirect: "manual" });
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { code: res.status, body };
  } catch {
    return { code: 0, body: null };
  }
}

// Anonymous GET with no auth, manual redirects, 10s timeout — the
// reachability probe shared by every detector that needs to know whether a
// URL is up before trying anything authenticated against it
// (jfrog-detect-server-ping.mjs, jfrog-detect-catalog-runtime.mjs's Part
// A). Never throws: any connection failure (DNS, TLS, timeout, refused)
// collapses to "000" so callers can treat that one string as the uniform
// "unreachable" case.
export async function anonymousFetchStatus(endpoint) {
  try {
    const res = await fetch(endpoint, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    return String(res.status);
  } catch {
    return "000";
  }
}

// Node's built-in fetch does not read HTTPS_PROXY/HTTP_PROXY, so telling
// the user to set them wouldn't fix anything here — point at the network
// itself instead. Shared so the wording can't drift between the call
// sites that append it to a "connection failed" detail on a "000" status.
export const NETWORK_UNREACHABLE_HINT = " (on a corporate network or VPN? this JPD may be unreachable from your current network)";

export function defaultServerId(configList) {
  const hit = configList.find((s) => s && s.isDefault === true);
  return hit && typeof hit.serverId === "string" ? hit.serverId : "";
}

export function urlForServer(configList, serverId) {
  const hit = configList.find((s) => s && s.serverId === serverId);
  if (!hit) return "";
  return (typeof hit.url === "string" && hit.url) || (typeof hit.artifactoryUrl === "string" && hit.artifactoryUrl) || "";
}

// The "ask which server" result shape every detector emits when
// resolveJfServer() can't pick one — multiple servers configured, none
// marked isDefault. Shared so the wording and candidates derivation can't
// drift apart between the detectors that all hit this same condition
// (jfrog-detect-catalog-runtime.mjs, jfrog-detect-project.mjs,
// jfrog-detect-server-ping.mjs). Exit code 2 is the caller's own
// responsibility, same as every other emit().
export function askServerResult(check, configList) {
  return {
    check,
    status: "ask",
    // `unresolved: "server"` lets a caller tell this apart from a
    // check-specific ask (e.g. jfrog-detect-project.mjs's own "no project
    // input" ask) even though both are `{check, status: "ask"}` — without
    // it, a caller keying off `check` alone (e.g. the Step 6 project
    // picker) would misroute this into asking about the wrong thing. See
    // references/project-picker.md's discriminator note.
    unresolved: "server",
    detail: "multiple jf servers configured, none marked isDefault — pass a server-id or set JF_SERVER_ID",
    candidates: configList.map((s) => s.serverId).filter(Boolean),
  };
}

// The full "no server resolvable" fallback every detector that takes a
// [server-id] falls into when resolveJfServer() returns nothing: either
// zero servers configured (red, blocking) or multiple with none marked
// default (ask, non-blocking). Shared — not just askServerResult() above
// — so the message/exit-code pairing for this one condition can't drift
// between the detectors that all hit it (jfrog-detect-catalog-runtime.mjs,
// jfrog-detect-project.mjs, jfrog-detect-server-ping.mjs). Emits and
// returns the exit code the caller should set and return with.
export function emitNoServerResolved(check, configList) {
  if (configList.length === 0) {
    emit({ check, status: "red", detail: "no jf server configured — run `jf config add --interactive`" });
    return 1;
  }
  emit(askServerResult(check, configList));
  return 2;
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// The four supported placeholder forms — `${VAR}` or bare `$VAR` followed
// by a non-identifier character or end of string — and nothing looser.
// Independently-optional braces (`\{?...\}?`) would also match malformed
// or unrelated text like `${JFROG_URL_SUFFIX}` or an unclosed `${JFROG_URL`;
// the `\b` after the bare form and the exact `\{...\}` pairing rule both
// out. Shared by the detector (jfrog-detect-jfrog-mcp.mjs) and the
// substituter (jfrog-substitute-mcp-placeholders.mjs) so "is there a
// placeholder?" and "replace the placeholder" agree on what counts as one.
const MCP_PLACEHOLDER_PATTERN = "\\$\\{(?:JFROG_PLATFORM_URL|JFROG_URL)\\}|\\$(?:JFROG_PLATFORM_URL|JFROG_URL)\\b";

export function hasMcpPlaceholder(text) {
  return new RegExp(MCP_PLACEHOLDER_PATTERN).test(text);
}

// Shared "is `mcpServers.jfrog` a valid object, and what's its `.url`?"
// check — used by the detector (jfrog-detect-jfrog-mcp.mjs, to decide if
// there's a url worth validating) and the substituter
// (jfrog-substitute-mcp-placeholders.mjs, to decide if there's a url worth
// rewriting) so the two agree on what counts as a valid entry, the same
// way MCP_PLACEHOLDER_PATTERN keeps "is there a placeholder?" in sync.
// Returns the url string (possibly empty) on a valid entry, null otherwise.
export function jfrogMcpUrl(parsed) {
  const entry = parsed?.mcpServers?.jfrog;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  return typeof entry.url === "string" ? entry.url : null;
}

// Fresh RegExp instances every call — a shared module-level `g`-flagged
// regex would carry `lastIndex` state across calls and silently miss
// matches on reuse.
export function mcpPlaceholderRegexes() {
  return {
    withScheme: new RegExp(`(https?:\\/\\/)(?:${MCP_PLACEHOLDER_PATTERN})`, "g"),
    bare: new RegExp(MCP_PLACEHOLDER_PATTERN, "g"),
  };
}
