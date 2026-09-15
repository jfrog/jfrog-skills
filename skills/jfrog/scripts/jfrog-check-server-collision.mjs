#!/usr/bin/env node
// jfrog-check-server-collision.mjs — Guard against `jf config add` silently
// overwriting an unrelated server's credentials.
//
// A derived server ID drops the scheme, port and path, so it can collide
// with an unrelated server already configured under the same name — the
// remove/add in jfrog-login-save-credentials.sh would delete that entry's
// credentials silently without this check.
//
// Usage:
//   node jfrog-check-server-collision.mjs <server-id> <platform-url>
//
// Exit codes:
//   0 — no collision (safe to proceed); nothing printed
//   1 — collision: an existing server with this ID points elsewhere;
//       its normalized URL is printed to stdout
//
// Any failure to determine the existing config (jf not runnable, malformed
// JSON, etc.) fails open — same as "no collision" — rather than blocking
// login on an unrelated jf/config problem.

import { execFileSync } from "node:child_process";

function normalizeJpdUrl(url) {
  if (!url) return "";
  let u = url.replace(/\/+$/, "");
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
  if (!/^https?:\/\//.test(u)) u = `https://${u}`;
  return u;
}

const [serverId, platformUrl] = process.argv.slice(2);

try {
  const raw = execFileSync("jf", ["config", "show", "--format=json"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const list = JSON.parse(raw);
  const entry = Array.isArray(list)
    ? list.find((s) => s && s.serverId === serverId)
    : null;
  const existingUrl =
    entry &&
    ((typeof entry.url === "string" && entry.url) ||
      (typeof entry.artifactoryUrl === "string" && entry.artifactoryUrl) ||
      "");
  if (existingUrl) {
    const normExisting = normalizeJpdUrl(existingUrl);
    const normNew = normalizeJpdUrl(platformUrl);
    if (normExisting !== normNew) {
      process.stdout.write(normExisting);
      process.exit(1);
    }
  }
} catch {
  // Fail open — matches the previous behavior of swallowing lookup errors
  // and proceeding as if no existing entry was found.
}
process.exit(0);
