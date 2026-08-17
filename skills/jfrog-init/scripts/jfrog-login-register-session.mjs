#!/usr/bin/env node
// jfrog-login-register-session.mjs — Verify a JFrog server and start a web login session
//
// Pings the server, generates a session UUID, and registers it with
// the Access API for browser-based authentication (bootstrap HTTP via
// `jf api --url`).
//
// Usage:
//   node jfrog-login-register-session.mjs <platform-url>
//
// Arguments:
//   platform-url  — Full JFrog Platform URL (e.g. https://mycompany.jfrog.io)
//
// Output (stdout, one key=value per line):
//   SESSION_UUID=<uuid>
//   VERIFY_CODE=<last 4 chars of uuid>
//
// Exit codes:
//   0 — Session registered successfully
//   1 — Missing arguments or prerequisites
//   2 — Server not reachable (ping failed)
//   3 — Session registration request failed

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { jfApi, parseHttpStatus } from "./lib/jf-api.mjs";
import { isMainModule } from "./lib/jf.mjs";
import { SAFE_URL } from "./jfrog-login-save-credentials.mjs";

// Pins stdio so a failing/logging `jf` subprocess can't leak output to
// this script's own stderr (Node's execFileSync default is to echo the
// child's stderr live to the parent) — see lib/jf-api.mjs's jfApi() for
// the full rationale. Still captures both streams via the thrown error's
// .stdout/.stderr on failure.
function execFileOpts(timeoutMs) {
  return {
    encoding: "utf8",
    timeout: timeoutMs,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  };
}

// `jf api` was added in JFrog CLI 2.100.0 and every request below depends
// on it. Checked explicitly: on an older CLI the ping fails with an
// unknown-command error that carries no HTTP status, which would
// otherwise be reported as an unreachable server and send the user
// looking at the network instead of the CLI. A single `jf api --help`
// probe also doubles as the "is jf even installed" check — its ENOENT
// case is indistinguishable from "jf missing" either way. Step 2 already
// gates on MIN_JF_VERSION = 2.106.0 (above the 2.100.0 that shipped `jf
// api`), so by the time this runs `jf api` is guaranteed present — this
// check exists for the rare case this script runs standalone, outside
// the normal Step 2 → Step 3 walk order.
function checkJfApiSupport() {
  try {
    execFileSync("jf", ["api", "--help"], execFileOpts(10_000));
    return { ok: true };
  } catch (err) {
    if (err.code === "ENOENT") return { ok: false, reason: "missing" };
    let version = "version unknown";
    try {
      version = execFileSync("jf", ["--version"], execFileOpts(10_000)).trim();
    } catch {
      // Leave the "version unknown" default.
    }
    return { ok: false, reason: "outdated", version };
  }
}

export function registerSession(platformUrlRaw) {
  if (!platformUrlRaw) {
    process.stderr.write("Usage: node jfrog-login-register-session.mjs <platform-url>\n");
    return 1;
  }
  const platformUrl = platformUrlRaw.replace(/\/+$/, "");
  if (!SAFE_URL.test(platformUrl)) {
    process.stderr.write("ERROR: platform URL contains unexpected characters.\n");
    return 1;
  }

  const support = checkJfApiSupport();
  if (!support.ok) {
    if (support.reason === "missing") {
      process.stderr.write("ERROR: jf is not installed\n");
    } else {
      process.stderr.write(`ERROR: this jf (${support.version}) does not support 'jf api',\n`);
      process.stderr.write("which this login flow requires (JFrog CLI 2.100.0 or later).\n");
      process.stderr.write("Upgrade the JFrog CLI, then retry.\n");
    }
    return 1;
  }

  // Verify server is reachable (unauthenticated ping)
  const ping = jfApi(["--url", platformUrl, "/artifactory/api/system/ping"]);
  if (!ping.ok) {
    const code = parseHttpStatus(ping.stderr);
    process.stderr.write(`ERROR: Server not reachable at ${platformUrl} (HTTP ${code})\n`);
    return 2;
  }

  const sessionUuid = randomUUID();
  const verifyCode = sessionUuid.slice(-4);

  // Register the session with the Access API
  const register = jfApi([
    "--url",
    platformUrl,
    "-X",
    "POST",
    "-H",
    "Content-Type: application/json",
    "-d",
    JSON.stringify({ session: sessionUuid }),
    "/access/api/v2/authentication/jfrog_client_login/request",
  ]);
  if (!register.ok) {
    const code = parseHttpStatus(register.stderr);
    process.stderr.write(`ERROR: Session registration failed (HTTP ${code})\n`);
    return 3;
  }

  process.stdout.write(`SESSION_UUID=${sessionUuid}\n`);
  process.stdout.write(`VERIFY_CODE=${verifyCode}\n`);
  return 0;
}

// Sets process.exitCode rather than calling process.exit() — a forced
// exit can truncate a still-draining stdout write if output is piped.
if (isMainModule(import.meta.url)) {
  process.exitCode = registerSession(process.argv[2] || "");
}
