#!/usr/bin/env node
// Registers the JFrog Claude agent-plugin marketplace for the server this walk
// resolved. See references/marketplace-setup.md.
//
// Usage: node jfrog-add-claude-marketplace.mjs [server-id] [project-key]
// Exit 0 -> registered
// Exit 1 -> unusable jf config, Claude Code too old, or the marketplace call failed
// Exit 3 -> jf missing or not running, or claude missing from PATH

import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { claude, claudeVersion, marketplaceNames, marketplaceUpdate } from "./lib/claude.mjs";
import { declareMarketplace, MARKETPLACE_PATH } from "./lib/claude-config.mjs";
import { jfApi, parseHttpStatus } from "./lib/jf-api.mjs";
import {
  describeJfUnavailable,
  isMainModule,
  jfAvailable,
  jfConfigExportResult,
  jfConfigShow,
  parseJpdUrl,
  urlForServer,
} from "./lib/jf.mjs";
import { isOlderThan } from "./jfrog-detect-jf-cli.mjs";
import { resolveJfServer } from "./jfrog-resolve-jf-server.mjs";

const MIN_CLAUDE_VERSION = "2.1.238"; // the first with a marketplace headersHelper
const HELPER_SOURCE = join(dirname(fileURLToPath(import.meta.url)), "jfrog-marketplace-headers.mjs");
const MARKETPLACE_PREFIXES = ["", "/bridge-client"]; // SaaS first, then self-hosted
// Claude Code runs the helper through a shell, so the id and path must not read
// as shell syntax.
const SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHELL_SYNTAX = /["$`\\%!\r\n]/;
// A plain directory name on every OS (Windows trims a trailing dot): claude
// keys its cache by it, and it reaches argv. Not a reserved device name (CON,
// NUL, COM1...), which Windows refuses as a directory, with or without an extension.
const MARKETPLACE_NAME = /^(?!(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$))[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/i;

// process.exit() can cut off a piped stdout write.
const fail = (msg, exitCode = 1) => {
  throw Object.assign(new Error(msg), { exitCode });
};

// The resolved id, pinned: the helper must keep asking for this server even
// after the user changes jf's default.
function resolveServer(argServerId) {
  const configList = jfConfigShow();
  const serverId = resolveJfServer(argServerId, configList);
  if (!serverId) fail("ERROR: no default jf server. Run 'jf login' or 'jf config use <sid>'.");
  if (!configList.some((s) => s?.serverId === serverId)) fail(`ERROR: no jf server '${serverId}' configured.`);
  if (!SERVER_ID.test(serverId)) {
    fail(`ERROR: jf server id '${serverId}' must be letters, digits, '.', '_' or '-' to reach Claude Code's headersHelper; add the marketplace manually.`);
  }
  const jpd = parseJpdUrl(urlForServer(configList, serverId));
  if (!jpd) fail("ERROR: could not parse the jf server URL.");
  return { serverId, jpd };
}

// Asked through jf, which holds the token and honors the proxy settings, because
// the name the catalog declares is the key claude stores it under — and so finds
// the prefix that answers.
function findMarketplace({ serverId, jpd }, projectKey) {
  const baseUrl = `${jpd.origin}${jpd.pathname.replace(/\/+$/, "")}`;
  const query = projectKey ? `?projectKey=${encodeURIComponent(projectKey)}` : "";
  const failures = [];
  for (const prefix of MARKETPLACE_PREFIXES) {
    const path = `${prefix}${MARKETPLACE_PATH}${query}`;
    const { ok, stdout, stderr, error } = jfApi([`--server-id=${serverId}`, path]);
    // jf exits 0 only on a 2xx, and prints the status only to stderr when it fails.
    const code = ok ? "200" : parseHttpStatus(stderr);
    let name;
    try {
      name = JSON.parse(stdout)?.name;
    } catch {
      // Not the catalog.
    }
    if (code === "200" && typeof name === "string" && MARKETPLACE_NAME.test(name)) {
      return { name, url: `${baseUrl}${path}` };
    }
    const why = code === "200" ? "no usable marketplace name"
      : error?.code === "ETIMEDOUT" ? "jf did not respond in time"
        : code === "0" ? "unreachable" : `HTTP ${code}`;
    failures.push(`${baseUrl}${path}: ${why}`);
  }
  fail(`ERROR: no marketplace at:\n${failures.join("\n")}`);
}

// Outside the skill directory, which moves on every plugin update. It holds no
// secret, so a plain copy will do.
function installHelper() {
  const target = join(process.env.JFROG_CLI_HOME_DIR || join(homedir(), ".jfrog"), "skills", "marketplace-headers.mjs");
  // Forward slashes, which node takes on Windows too and no shell reads as escapes.
  const path = target.split(sep).join("/");
  if (SHELL_SYNTAX.test(path)) fail(`ERROR: ${path} has a character a shell would read; add the marketplace manually.`);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, readFileSync(HELPER_SOURCE), { mode: 0o644, flag: "wx" });
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    fail(`ERROR: could not install ${target}: ${err.message}`);
  }
  return path;
}

// Returns `content` without each `machine host` entry whose password is `token`.
// Netrc is whitespace-separated words, so an entry may start mid-line: each
// runs to the next `machine`, `default` or `macdef` keyword, and a word after
// a key is its value, never a keyword. Every other entry is kept byte for
// byte, one for this host holding another password (the user's own, for
// another tool) included, and a macdef body is only text until the blank line
// that ends it.
export function dropNetrcToken(content, host, token) {
  const starts = [0];
  const entries = [[]]; // the words of each entry; the first holds what precedes any
  const word = /\S+/g;
  const blank = /\n[ \t\r]*(?:\n|$)/g;
  let value = false;
  for (let m = word.exec(content); m; m = word.exec(content)) {
    const kw = m[0].toLowerCase();
    if (value) {
      value = false;
    } else if (kw === "machine" || kw === "default" || kw === "macdef") {
      starts.push(m.index);
      entries.push([]);
      value = kw === "machine";
      if (kw === "macdef") {
        const eol = content.indexOf("\n", m.index);
        blank.lastIndex = eol;
        const end = eol < 0 ? null : blank.exec(content);
        word.lastIndex = end ? end.index + end[0].length : content.length;
      }
    } else {
      value = true;
    }
    entries.at(-1).push(m[0]);
  }
  starts.push(content.length);
  const holdsToken = (words) =>
    words[0].toLowerCase() === "machine" &&
    words[1]?.toLowerCase() === host &&
    words.some((key, at) => at >= 2 && at % 2 === 0 && key.toLowerCase() === "password" && words[at + 1] === token);
  return entries.map((words, i) => (i > 0 && holdsToken(words) ? "" : content.slice(starts[i], starts[i + 1]))).join("");
}

// The previous Step 8 wrote `machine <host> / login / password <token>` into
// ~/.netrc, and libcurl still sends it on plugin fetches. Only that block goes:
// through any symlink, so a dotfiles copy loses it too, and keeping the mode.
function removeNetrcToken(host, token) {
  // curl checks HOME before the platform default.
  const netrc = join(process.env.HOME || homedir(), ".netrc");
  let content;
  try {
    content = readFileSync(netrc, "utf8");
  } catch (err) {
    return err.code === "ENOENT" ? null : `could not read ${netrc}: ${err.message}`;
  }
  const rest = dropNetrcToken(content, host, token);
  if (rest === content) return null;
  let tmp;
  try {
    const target = realpathSync(netrc);
    const mode = statSync(target).mode & 0o777;
    tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, rest, { mode, flag: "wx" });
    chmodSync(tmp, mode);
    renameSync(tmp, target);
  } catch (err) {
    if (tmp) rmSync(tmp, { force: true });
    return `could not remove the old marketplace token from ${netrc}: ${err.message}`;
  }
  return null;
}

function register(argServerId, projectKey) {
  if (!jfAvailable()) fail(`ERROR: ${describeJfUnavailable()}`, 3);
  if (!claude.found) fail("ERROR: claude not on PATH.", 3);
  const version = claudeVersion();
  if (isOlderThan(version, MIN_CLAUDE_VERSION)) {
    fail(`ERROR: Claude Code ${version || "(version unknown)"} is older than ${MIN_CLAUDE_VERSION}, the first that runs a marketplace headersHelper. Update Claude Code, or add the marketplace manually.`);
  }

  const server = resolveServer(argServerId);
  const { name, url } = findMarketplace(server, projectKey);
  const helper = installHelper();
  const declared = declareMarketplace(name, {
    source: "url",
    url,
    headersHelper: `node "${helper}" "${server.serverId}"`,
  });
  if (!declared.ok) fail(`ERROR: ${declared.error}`);

  const { ok, out } = marketplaceUpdate(name);
  // A zero exit alone does not show that claude took the entry it was handed.
  const listed = ok && marketplaceNames()?.includes(name);
  if (!listed) {
    const stuck = declared.restore();
    process.stderr.write(out);
    if (ok) process.stderr.write(`ERROR: claude did not list marketplace '${name}' after the update.\n`);
    for (const file of stuck) process.stderr.write(`ERROR: could not restore ${file}\n`);
    return 1;
  }
  // libcurl matches a netrc machine by bare hostname.
  const token = jfConfigExportResult(server.serverId).cfg?.accessToken;
  const netrcError = token ? removeNetrcToken(server.jpd.hostname, token) : null;
  if (netrcError) process.stderr.write(`WARNING: ${netrcError}\n`);
  process.stdout.write(out);
  // SKILL.md reads the name from this line.
  process.stdout.write(`\nSuccessfully added marketplace: ${name}\n`);
  return 0;
}

async function main(argServerId, projectKey) {
  try {
    return register(argServerId, projectKey);
  } catch (err) {
    if (err.exitCode === undefined) throw err;
    process.stderr.write(`${err.message}\n`);
    return err.exitCode;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv[2] || "", process.argv[3] || "");
}
