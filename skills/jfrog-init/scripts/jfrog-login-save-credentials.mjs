#!/usr/bin/env node
// jfrog-login-save-credentials.mjs — Complete web login by retrieving token and saving credentials
//
// Retrieves the one-time access token from a completed web login session,
// derives a server ID, saves the configuration via jf config, and verifies.
// Bootstrap token exchange uses `jf api --url` (before any server exists in
// `jf config`); verification uses `jf api` with --server-id.
//
// Leaves the current default `jf` server unchanged. Subsequent calls should
// pass `--server-id=<id>` explicitly.
//
// IMPORTANT: The token endpoint is one-time-use. If this script fails after
// consuming the token (e.g. jf config write blocked by sandbox), the session
// is burned and login must restart from register-session.
//
// Usage:
//   node jfrog-login-save-credentials.mjs <platform-url> <session-uuid>
//
// Arguments:
//   platform-url  — Full JFrog Platform URL (e.g. https://mycompany.jfrog.io)
//   session-uuid  — Session UUID from jfrog-login-register-session.mjs output
//
// Output (stdout):
//   SERVER_ID=<derived-server-id>
//   Followed by the Artifactory version JSON on success.
//
// Exit codes:
//   0 — Login succeeded, credentials saved and verified
//   1 — Missing arguments or prerequisites
//   2 — Token retrieval failed (user may not have completed browser login)
//   3 — Empty token in response
//   4 — jf config save or verification failed

import { execFileSync } from "node:child_process";
import { jfApi, parseHttpStatus } from "./lib/jf-api.mjs";
import {
  isMainModule,
  jfConfigShow,
  normalizeJpdUrl,
  selfHealPath,
  urlForServer,
} from "./lib/jf.mjs";
import { resolveCommand } from "./lib/command.mjs";

// A `jf.cmd` shim runs under a shell, which concatenates arguments unescaped,
// so everything interpolated into a `jf` argument is screened first.
export const SAFE_URL = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/;
const SAFE_TOKEN = /^[A-Za-z0-9._-]+$/;

// Derive server ID from URL
// SaaS:        https://mycompany.jfrog.io  → mycompany
// Self-hosted:  https://artifactory.internal.corp → artifactory-internal-corp
export function deriveServerId(platformUrl) {
  let host = platformUrl.replace(/^[a-z]*:\/\//, "");
  host = host.replace(/\.jfrog\.io.*/, "");
  host = host.replace(/[./]/g, "-");
  return host;
}

// Pins stdio so a failing/logging `jf` subprocess can't leak output to
// this script's own stderr (Node's execFileSync default is to echo the
// child's stderr live to the parent) — see lib/jf-api.mjs's jfApi() for
// the full rationale. Still captures both streams via the thrown error's
// .stdout/.stderr on failure.
function execFileOpts(timeoutMs, needsShell) {
  return {
    encoding: "utf8",
    timeout: timeoutMs,
    shell: needsShell,
    stdio: ["ignore", "pipe", "pipe"],
  };
}

export function saveCredentials(platformUrlRaw, sessionUuid) {
  if (!platformUrlRaw || !sessionUuid) {
    process.stderr.write("Usage: node jfrog-login-save-credentials.mjs <platform-url> <session-uuid>\n");
    return 1;
  }
  const platformUrl = platformUrlRaw.replace(/\/+$/, "");
  if (!SAFE_URL.test(platformUrl)) {
    process.stderr.write("ERROR: platform URL contains unexpected characters.\n");
    return 1;
  }

  selfHealPath();
  const { target: jfPath, shell: needsShell } = resolveCommand("jf");

  try {
    execFileSync(jfPath, ["--version"], execFileOpts(10_000, needsShell));
  } catch (err) {
    if (err.code === "ENOENT") {
      process.stderr.write("ERROR: jf is not installed\n");
      return 1;
    }
    // Broken/hung jf: fall through and let the jf api calls below surface
    // their own more specific failure.
  }

  const serverId = deriveServerId(platformUrl);

  // Retrieve the one-time token (stdout = JSON body; stderr = jf status lines)
  const tokenResp = jfApi([
    "--url",
    platformUrl,
    `/access/api/v2/authentication/jfrog_client_login/token/${sessionUuid}`,
  ]);

  if (!tokenResp.ok) {
    let httpCode = parseHttpStatus(tokenResp.stderr);
    if (httpCode === "0") httpCode = parseHttpStatus(tokenResp.stdout);
    const exitStatus = (tokenResp.error && tokenResp.error.status) ?? 1;
    process.stderr.write(`ERROR: Token retrieval failed (HTTP ${httpCode}, exit ${exitStatus}).\n`);
    if (httpCode === "400") {
      process.stderr.write("The user may not have completed the browser login yet.\n");
    }
    return 2;
  }

  const bodyText = tokenResp.stdout
    .split("\n")
    .filter((line) => !line.includes("[Info]"))
    .join("\n");

  let accessToken = "";
  try {
    const parsed = JSON.parse(bodyText);
    accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
  } catch {
    accessToken = "";
  }

  if (!accessToken) {
    process.stderr.write("ERROR: Response contained no access token. Login must restart from step 1.\n");
    return 3;
  }
  if (!SAFE_TOKEN.test(accessToken)) {
    process.stderr.write("ERROR: Received token has an unexpected format. Login must restart from step 1.\n");
    return 3;
  }

  // A derived server ID drops the scheme, port and path, so it can collide
  // with an unrelated server already configured under the same name — the
  // remove/add below would delete that entry's credentials silently.
  const existingUrl = normalizeJpdUrl(urlForServer(jfConfigShow(), serverId));
  if (existingUrl && existingUrl !== normalizeJpdUrl(platformUrl)) {
    process.stderr.write(`ERROR: jf server '${serverId}' already points at ${existingUrl} — refusing to overwrite it.\n`);
    return 4;
  }

  // Save credentials to jf config (writes to ~/.jfrog/, needs unrestricted filesystem)
  try {
    execFileSync(jfPath, ["config", "remove", serverId, "--quiet"], execFileOpts(10_000, needsShell));
  } catch {
    // No existing entry to remove — fine.
  }

  try {
    execFileSync(
      jfPath,
      ["config", "add", serverId, `--url=${platformUrl}`, `--access-token=${accessToken}`, "--interactive=false"],
      execFileOpts(15_000, needsShell)
    );
  } catch {
    process.stderr.write("ERROR: Failed to save credentials with jf config add.\n");
    process.stderr.write("This may be caused by sandbox restrictions on ~/.jfrog/ writes.\n");
    return 4;
  }

  process.stdout.write(`SERVER_ID=${serverId}\n`);
  process.stdout.write("--- Verifying authentication ---\n");

  const verify = jfApi([`--server-id=${serverId}`, "/artifactory/api/system/version"]);
  process.stdout.write(verify.stdout);
  if (!verify.ok) {
    process.stderr.write("ERROR: Authentication verification failed. Token may not have saved correctly.\n");
    return 4;
  }

  return 0;
}

// Sets process.exitCode rather than calling process.exit() — a forced
// exit can truncate a still-draining stdout write if output is piped.
if (isMainModule(import.meta.url)) {
  process.exitCode = saveCredentials(process.argv[2] || "", process.argv[3] || "");
}
