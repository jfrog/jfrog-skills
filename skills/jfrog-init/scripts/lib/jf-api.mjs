// jf-api.mjs — shared `jf api` bootstrap-call helpers for the web-login
// scripts (jfrog-login-register-session.mjs, jfrog-login-save-credentials.mjs).
// These run before any server exists in `jf config`, so every call goes
// through `jf api --url <url> ...` rather than a configured --server-id —
// a distinct mode from lib/jf.mjs's runJf(), which always assumes a
// configured server.

import { execFileSync } from "node:child_process";
import { resolveCommand } from "./command.mjs";

// Matches jf rt ping's own network-call timeout (lib/jf.mjs's
// JF_CLI_TIMEOUT_MS) for the same reason: long enough that a slow JPD
// doesn't misreport as "unreachable".
const JF_API_TIMEOUT_MS = 30_000;

// Parses the last "Http Status: NNN" line `jf api` prints. Returns "0"
// when no such line is present — the sentinel for "couldn't determine a
// status."
export function parseHttpStatus(text) {
  const lines = String(text || "")
    .split("\n")
    .filter((l) => l.includes("Http Status:"));
  const line = lines[lines.length - 1] || "";
  const m = line.match(/Http Status:\s*(\d+)/);
  return m ? m[1] : "0";
}

// Runs `jf api <...args>`, returning both streams and exit info instead of
// throwing — a non-zero exit (unreachable server, a 400 on an unfinished
// login, etc) is an expected outcome the caller branches on, not a script
// bug.
export function jfApi(args) {
  try {
    const { target, shell } = resolveCommand("jf");
    const stdout = execFileSync(target, ["api", ...args], {
      encoding: "utf8",
      timeout: JF_API_TIMEOUT_MS,
      shell,
      // Node's execFileSync/execSync echo the child's stderr to the
      // parent's own stderr live by default ("stderr by default will be
      // output to the parent's stderr unless stdio is specified" per the
      // Node docs) — on top of still populating err.stderr for a failed
      // call. Left at the default, every `jf api` info/warn log line
      // (e.g. "Http Status: NNN") would leak straight to the terminal.
      // Pinning stdio here keeps this silent: nothing is inherited,
      // everything is still captured.
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString() : "";
    const stderr = err.stderr ? err.stderr.toString() : "";
    return { ok: false, stdout, stderr, error: err };
  }
}
