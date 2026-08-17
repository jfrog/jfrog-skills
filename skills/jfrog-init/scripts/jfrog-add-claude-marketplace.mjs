#!/usr/bin/env node
// Registers the JFrog Claude agent-plugin marketplace for the server this walk
// resolved. See references/marketplace-setup.md.
//
// Usage: node jfrog-add-claude-marketplace.mjs [server-id]
// Exit 0 -> registered
// Exit 1 -> unusable jf config, or the marketplace call failed
// Exit 3 -> jf missing or not running, or claude missing from PATH

import { claude, marketplaceAdd } from "./lib/claude.mjs";
import {
  describeJfUnavailable,
  isMainModule,
  JF_CLI_TIMEOUT_MS,
  jfAvailable,
  jfConfigExportResult,
  jfConfigShow,
  parseJpdUrl,
  tokenUsername,
} from "./lib/jf.mjs";
import { writeNetrc } from "./lib/netrc.mjs";
import { resolveJfServer } from "./jfrog-resolve-jf-server.mjs";

const MARKETPLACE_PATH = "/ml/core/api/v1/ai-registry/agent-plugins/custom/marketplace/claude-marketplace.json";
const MARKETPLACE_PREFIXES = ["", "/bridge-client"]; // SaaS first, then self-hosted

// process.exit() can cut off a piped stdout write.
const fail = (msg, exitCode = 1) => {
  throw Object.assign(new Error(msg), { exitCode });
};

function readServerCreds(serverId) {
  const { cfg, timedOut } = jfConfigExportResult(serverId);
  if (timedOut) {
    fail(`ERROR: jf did not respond within ${JF_CLI_TIMEOUT_MS / 1000}s (running: jf config export).`);
  }
  if (!cfg) {
    fail(serverId
      ? `ERROR: no jf server '${serverId}' configured.`
      : "ERROR: no default jf server. Run 'jf login' or 'jf config use <sid>'.");
  }

  const jpd = parseJpdUrl(cfg.url || cfg.artifactoryUrl || "");
  if (!jpd) fail("ERROR: could not parse the jf server URL.");

  const token = cfg.accessToken || "";
  const login = cfg.user || (token ? tokenUsername(serverId) : "");
  if (!token || !login) fail(`ERROR: missing access token or username for '${serverId}'. Run 'jf login'.`);

  return { jpd, login, token };
}

function marketplaceUrl({ jpd, login, token }, prefix) {
  const userinfo = `${encodeURIComponent(login)}:${encodeURIComponent(token)}`;
  const base = `${jpd.host}${jpd.pathname.replace(/\/+$/, "")}`;
  return `${jpd.protocol}//${userinfo}@${base}${prefix}${MARKETPLACE_PATH}`;
}

function redactToken(text, token) {
  return text.split(encodeURIComponent(token)).join("***");
}

function register(argServerId) {
  if (!jfAvailable()) fail(`ERROR: ${describeJfUnavailable()}`, 3);
  if (!claude.found) fail("ERROR: claude not on PATH.", 3);

  const creds = readServerCreds(resolveJfServer(argServerId, jfConfigShow()));
  // libcurl matches a netrc machine by bare hostname.
  const wrote = writeNetrc(creds.jpd.hostname, creds.login, creds.token);
  if (!wrote.ok) fail(`ERROR: ${wrote.error}`);

  const failures = [];
  for (const prefix of MARKETPLACE_PREFIXES) {
    const { ok, out } = marketplaceAdd(marketplaceUrl(creds, prefix));
    if (ok) {
      process.stdout.write(redactToken(out, creds.token));
      return 0;
    }
    failures.push(out);
  }
  process.stderr.write(redactToken(failures.join(""), creds.token));
  return 1;
}

function main(argServerId) {
  try {
    return register(argServerId);
  } catch (err) {
    if (err.exitCode === undefined) throw err;
    process.stderr.write(`${err.message}\n`);
    return err.exitCode;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv[2] || "");
}
