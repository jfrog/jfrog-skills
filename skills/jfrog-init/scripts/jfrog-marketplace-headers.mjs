#!/usr/bin/env node
// Prints the auth header for the JFrog marketplace, for a marketplace source's
// headersHelper. Harness-neutral: it asks jf for the header at request time, so
// no copy of the token is stored. Self-contained, since it is copied out of the
// skill directory. See references/marketplace-setup.md.
//
// Usage: node jfrog-marketplace-headers.mjs <server-id>
// Exit 0 -> one JSON object of headers on stdout
// Exit 1 -> no usable jf server; the reason on stderr, never a credential

import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const JF_TIMEOUT_MS = 30_000; // room for an OS credential-store prompt
// The id arrives through a shell command line.
const SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// PATH, then jf's own install directory, as lib/command.mjs and lib/jf.mjs look.
function findJf() {
  const win = process.platform === "win32";
  const names = win ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((ext) => `jf${ext.toLowerCase()}`) : ["jf"];
  const dirs = [...(process.env.PATH || "").split(delimiter), join(homedir(), ".jfrog", "bin")].filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      try {
        accessSync(join(dir, name), win ? constants.F_OK : constants.X_OK);
        return join(dir, name);
      } catch {
        // Not here.
      }
    }
  }
  return "jf";
}

function authHeader(serverId) {
  const jf = findJf();
  // Node spawns a .cmd shim only through a shell; the id was screened above.
  const shell = /\.(cmd|bat)$/i.test(jf);
  process.noDeprecation = true;
  const out = execFileSync(shell ? `"${jf}"` : jf, ["config", "export", serverId], {
    encoding: "utf8",
    timeout: JF_TIMEOUT_MS,
    shell,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "true" },
  });
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const cfg = JSON.parse(Buffer.from(lines[lines.length - 1] || "", "base64").toString("utf8"));
  if (cfg.accessToken) return { Authorization: `Bearer ${cfg.accessToken}` };
  if (cfg.user && cfg.password) return { Authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}` };
  return null;
}

const serverId = process.argv[2] || "";
if (!SERVER_ID.test(serverId)) {
  process.stderr.write("usage: jfrog-marketplace-headers.mjs <server-id>\n");
  process.exitCode = 1;
} else {
  let header = null;
  try {
    header = authHeader(serverId);
  } catch {
    // jf's own message may quote the config, so it is not passed on.
  }
  if (header) {
    process.stdout.write(`${JSON.stringify(header)}\n`);
  } else {
    process.stderr.write(`jf server '${serverId}' unavailable; run 'jf login'\n`);
    process.exitCode = 1;
  }
}
