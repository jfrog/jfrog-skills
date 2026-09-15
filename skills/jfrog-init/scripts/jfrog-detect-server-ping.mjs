#!/usr/bin/env node
// Two-part reachability + credentials check for the configured JFrog server.
// Idempotent, read-only, zero mutation. Emits one JSON line to stdout.
//
// Part A — reachability (anonymous):
//   Pull <url> from `jf c show --format=json` for the resolved server, then
//   fetch <url>/artifactory/api/system/ping with no auth. Confirms the URL
//   stored in `jf config` actually resolves to a live Artifactory. HTTP
//   200/401/403 = up (the endpoint responded even without auth). 404 /
//   connection failure / 5xx = red, and Part B is skipped.
//
// Part B — credentials (authenticated, via jf):
//   `jf rt ping --server-id=<id>`. The token stays inside jf's process —
//   this script never reads, prints, or stores it. A pass means the token
//   in `jf config` is valid, not expired, and authorized to hit
//   Artifactory — the earliest possible signal of stale credentials.
//
// BOTH must pass for green. Part A green with Part B red distinguishes
// "URL wrong" from "token expired/invalid" — two distinct fixes.
//
// Usage: node jfrog-detect-server-ping.mjs [server-id]
// Exit 0 -> green (URL reachable AND jf rt ping succeeded)
// Exit 1 -> red   (jf missing, no URL, fetch or jf rt ping failed)
// Exit 2 -> ask   (multiple servers configured, no server-id resolvable —
//                  caller must prompt the user and re-invoke with the
//                  picked server-id). Servers are enumerated in
//                  `candidates` in the JSON detail.
//
// No corresponding fix script — per the skill's dependency-order rule, a
// failed ping is a stop-and-warn condition, not something auto-fixed.

import { emit, isMainModule, urlForServer, normalizeJpdUrl, anonymousFetchStatus, NETWORK_UNREACHABLE_HINT, runJf } from "./lib/jf.mjs";
import { resolveServerOrEmit } from "./jfrog-resolve-jf-server.mjs";

// Extract the first meaningful error line rather than dumping the whole jf
// output (which can include multi-line nginx HTML for cookie/proxy errors).
// `jf`'s own error text shouldn't contain a token, but the redaction below
// is defense in depth against a future jf version leaking one into stderr.
// Boundaries are explicit character-class lookarounds rather than `\b` —
// `\b` doesn't fire between two non-word characters (e.g. a space and a
// leading `-`/`_`, both valid base64url token chars), which would leave
// part of a token unredacted.
function extractErr(out) {
  const lines = out.split("\n");
  const line =
    lines.find((l) => l.includes("[Error]")) ||
    lines.find((l) => l.includes("[Warn]")) ||
    lines.find((l) => l.trim()) ||
    out;
  return line
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .replace(/\b(Bearer\s+)\S+/gi, "$1[redacted]")
    .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g, "[redacted]")
    .trim()
    .slice(0, 240);
}

// Only the auth-shaped failures below actually indicate a bad/expired
// token — a network timeout, a killed process, or a transient jf error
// says nothing about credentials and shouldn't be reported as if it did.
const AUTH_FAILURE_PATTERN = /\b(401|403|forbidden|bad credentials|invalid token|expired token)\b|\bunauthori[sz]/i;

// Exported so jfrog-detect-all.mjs can call this in-process instead of
// shelling out to a `node` subprocess and re-parsing its stdout — the
// same in-process pattern jfrog-resolve-jf-server.mjs /
// jfrog-resolve-mcp-config.mjs / jfrog-substitute-mcp-placeholders.mjs
// use. The CLI entry point below is a thin wrapper around this function.
//
// Every branch below emits exactly once and returns the exit code rather
// than calling process.exit() — a forced exit can truncate the JSON line
// if stdout is still draining through a pipe.
export async function detectServerPing(serverIdArg) {
  const resolved = resolveServerOrEmit("server-ping", serverIdArg, { status: "red", exitCode: 1 });
  if (resolved.exitCode !== null) {
    return resolved.exitCode;
  }
  const { serverId, configList } = resolved;

  const url = normalizeJpdUrl(urlForServer(configList, serverId));
  if (!url) {
    emit({ check: "server-ping", status: "red", detail: `no url found in jf config for server-id=${serverId}` });
    return 1;
  }

  const endpoint = `${url}/artifactory/api/system/ping`;

  const httpCode = await anonymousFetchStatus(endpoint);

  // Node's fetch ignores HTTP(S)_PROXY and validates TLS against Node's own
  // bundled CA list rather than the system store, so a "000" here can mean
  // "this Node process specifically can't reach it" (corporate proxy,
  // internal CA) rather than "the server is actually down." `jf` itself is
  // the authoritative client — it's what the rest of the skill relies on —
  // so treat Part A as advisory on "000" and let Part B's `jf rt ping`
  // decide. A genuine bad HTTP code (404/5xx/etc, meaning something did
  // answer) is still a hard red: that's not a proxy/TLS artifact.
  const anonymousUnreachable = httpCode === "000";
  if (!anonymousUnreachable && !(httpCode.startsWith("2") || httpCode.startsWith("3") || httpCode === "401" || httpCode === "403")) {
    emit({ check: "server-ping", status: "red", detail: `GET ${endpoint} returned HTTP ${httpCode}` });
    return 1;
  }

  // ---------- Part B: authenticated `jf rt ping` (token from `jf config`) ----------
  let jfOut = "";
  let jfOk = false;
  let timedOut = false;
  try {
    const args = serverId ? ["rt", "ping", `--server-id=${serverId}`] : ["rt", "ping"];
    jfOut = runJf(args, { timeoutMs: 30_000 });
    jfOk = true;
  } catch (err) {
    // execFileSync's thrown error does NOT set `.killed` on a timeout —
    // that's a `ChildProcess` instance property, not part of the sync
    // error shape. The reliable signal is `.code === "ETIMEDOUT"`, which
    // Node sets itself when the timeout fires and it kills the child (see
    // the identical fix/comment in jfrog-detect-jf-cli.mjs). Without this,
    // `timedOut` was always false, so an actual `jf rt ping` timeout fell
    // through to the generic "failed" wording below instead of the
    // dedicated timeout message.
    timedOut = err.code === "ETIMEDOUT";
    jfOut = `${err.stdout || ""}${err.stderr || ""}` || err.message;
  }

  if (jfOk) {
    const detail = anonymousUnreachable
      ? `jf rt ping OK — anonymous GET ${endpoint} failed, but that only reflects this process's own network path (proxy/CA), not the server${NETWORK_UNREACHABLE_HINT}`
      : `reachable at ${endpoint} AND jf rt ping OK (HTTP ${httpCode})`;
    // `jpdUrl` is the caller's clean, structured way to get this walk's
    // resolved JPD URL — SKILL.md's Final Summary uses it (alongside
    // Step 6's `resolvedKey`) to call `jfrog-state-file.mjs set` directly,
    // without parsing a URL back out of the human-readable `detail` string.
    emit({ check: "server-ping", status: "green", detail, jpdUrl: url });
    return 0;
  }

  const rawErr = extractErr(jfOut);
  const detail = anonymousUnreachable
    ? timedOut
      ? `GET ${endpoint}: connection failed${NETWORK_UNREACHABLE_HINT}, AND jf rt ping timed out after 30s`
      : `GET ${endpoint}: connection failed${NETWORK_UNREACHABLE_HINT}, AND jf rt ping failed: ${rawErr}`
    : timedOut
      ? `URL reachable but jf rt ping timed out after 30s${NETWORK_UNREACHABLE_HINT}`
      : AUTH_FAILURE_PATTERN.test(jfOut)
        ? `URL reachable but jf rt ping failed — credentials in jf config may be invalid or expired: ${rawErr}`
        : `URL reachable but jf rt ping failed: ${rawErr}`;

  emit({ check: "server-ping", status: "red", detail });
  return 1;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await detectServerPing(process.argv[2]);
}
