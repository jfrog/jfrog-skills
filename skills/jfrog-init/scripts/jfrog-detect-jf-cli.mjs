#!/usr/bin/env node
// Detects whether the JFrog CLI (`jf`) is on PATH. Node's own presence is
// checked one step earlier, inline in jfrog-detect-all.mjs (running that
// .mjs file already proves Node exists, so it only needs to check the
// version). Everything downstream of that gate can safely assume Node.
//
// Idempotent, read-only, zero mutation. Emits one JSON line to stdout,
// with `reason` set on every red result so callers can tell "missing"
// apart from "outdated" without string-sniffing `detail`.
//
// Exit 0 -> green (jf found on PATH and >= MIN_JF_VERSION)
// Exit 1 -> red   (reason: "missing" — jf not found on PATH — or
//                  reason: "broken" — jf is on PATH but hung/failed to
//                  run — or reason: "outdated" — found, but below
//                  MIN_JF_VERSION)

import { emit, isMainModule, runJf, seedJfAvailable } from "./lib/jf.mjs";

// Required by Agent Plugins Repositories (Step 7's AI Catalog calls) —
// see docs.jfrog.com/artifactory/docs/agent-plugins-repositories
// ("Configure the JFrog CLI").
export const MIN_JF_VERSION = "2.106.0";

function parseVersionParts(str) {
  const m = str.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Plain X.Y.Z numeric comparison — jf CLI versions never carry a
// pre-release suffix on a stable release, so nothing fancier than this
// is needed. Unparseable input fails closed (treated as older, i.e.
// failing the minimum-version check) — a version string this script
// doesn't recognize is exactly the case where it must NOT silently wave
// an incompatible `jf` through as green.
//
// Exported so jfrog-install-jf-cli.mjs can reuse the exact same
// comparison to decide whether an already-present `jf` still needs
// updating — see that file's currentJfIsUpToDate().
export function isOlderThan(version, minVersion) {
  const a = parseVersionParts(version);
  const b = parseVersionParts(minVersion);
  if (!a || !b) return true;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

// Exported so jfrog-detect-all.mjs can call this in-process instead of
// shelling out to a `node` subprocess and re-parsing its stdout — the
// same in-process pattern jfrog-resolve-jf-server.mjs /
// jfrog-resolve-mcp-config.mjs / jfrog-substitute-mcp-placeholders.mjs
// use. The CLI entry point below is a thin wrapper around this function.
//
// One `jf --version` spawn does double duty as both the availability
// check and the version string for the detail field — calling
// jfAvailable() first and then running `--version` again to capture its
// output would spawn the same subprocess twice on every green-path run.
export function detectJfCli() {
  try {
    const version = runJf(["--version"]).trim().split("\n")[0] || "jf found on PATH";
    // Seed lib/jf.mjs's shared jfAvailable() cache with this same result —
    // see seedJfAvailable()'s doc comment for why: it stops a later
    // jfAvailable() call elsewhere in the same walk from spawning `jf`
    // again and risking a self-contradictory answer.
    seedJfAvailable(true);
    if (isOlderThan(version, MIN_JF_VERSION)) {
      emit({
        check: "jf-cli",
        status: "red",
        reason: "outdated",
        // `currentVersion` holds just the raw `jf --version` string, with
        // nothing else in it — jf-cli-update-prompt.md fills its
        // user-facing <version> placeholder from this field specifically
        // because `detail` (below) also carries the minimum-version number,
        // which that same prompt is required to never surface to the user.
        currentVersion: version,
        detail: `${version} — jfrog-init requires JFrog CLI >= ${MIN_JF_VERSION} (Agent Plugins Repositories requirement)`,
      });
      return 1;
    }
    emit({ check: "jf-cli", status: "green", detail: version });
    return 0;
  } catch (err) {
    // `reason` distinguishes "not on PATH at all" from "on PATH but
    // hung/corrupted" — the two route to different user-facing wording
    // (see jf-cli-install-prompt.md): "missing" says jf isn't installed,
    // which is simply false for a hung/corrupted binary that's sitting
    // right there on PATH.
    // execFileSync's thrown error does NOT set `.killed` on a timeout
    // (that's a `ChildProcess` instance property, not part of the sync
    // error shape) — the reliable signal is `.code === "ETIMEDOUT"`,
    // which Node sets itself when the timeout fires and it kills the
    // child. Verified directly: a stub that sleeps past the timeout
    // throws `{ code: "ETIMEDOUT", signal: "SIGTERM", killed: undefined }`.
    const timedOut = err && err.code === "ETIMEDOUT";
    const notFound = err && err.code === "ENOENT";
    const reason = notFound ? "missing" : "broken";
    const detail = notFound
      ? "JFrog CLI (jf) is not installed."
      : timedOut
        ? "JFrog CLI (jf) is on PATH but did not respond in time (may be corrupted or hung) — reinstalling should fix this."
        : `JFrog CLI (jf) is on PATH but failed to run (${(err && err.message) || "unknown error"}) — reinstalling should fix this.`;
    emit({ check: "jf-cli", status: "red", reason, detail });
    return 1;
  }
}

// Sets process.exitCode rather than calling process.exit() — a forced
// exit can truncate the JSON line's stdout write if it's still draining
// through a pipe.
if (isMainModule(import.meta.url)) {
  process.exitCode = detectJfCli();
}
