#!/usr/bin/env node
// Copyright (c) JFrog Ltd. 2026
// Licensed under the Apache License, Version 2.0
// https://www.apache.org/licenses/LICENSE-2.0
//
// JFrog Agent Guard activation check.
//
// Silent gate used by Step 0 of the jfrog-mcp-management skill. Determines
// whether the JFrog Agent Guard is enabled for the current environment.
//
// Contract:
//   - exit 0 -> Agent Guard ENABLED  (skill may proceed)
//   - exit 2 -> Agent Guard DISABLED (registry off, or _JF_AGENT_GUARD_FORCE_DISABLE)
//   - exit 3 -> AMBIGUOUS: no env creds, no default jf server, but two+
//               configured servers exist. Skill lists them and asks the user
//               to pick one; it must NOT auto-pick.
//   - exit 1 -> status UNKNOWN: no credentials, timeout, network/DNS error.
//               Not sure if Enabled or not.
//   - a single human-readable reason line is written to stdout for
//     diagnostics only; Step 0 keys off the EXIT CODE, not the text. The
//     exit-3 line ends with the candidate server ids.
//
// Set JF_AGENT_GUARD_DEBUG=true for verbose tracing on stderr.

import { execFileSync, execSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
import process from "node:process";

// Global `fetch` requires Node.js 18+.
const MIN_NODE_MAJOR = 18;

const SETTINGS_PATH =
  "/ml/core/api/v1/administration/account-settings/mcp_gateway_plugin_enabled";
// Self-hosted JPDs serve the same API behind `/bridge-client`. Tried ONLY
// after the root path 404s, so SaaS still costs exactly one request.
const BRIDGE_CLIENT_PREFIX = "/bridge-client";
// Matches the other `jf api` wrappers in this repo (slow JPD + TLS through
// a corporate proxy). Tests may override via JF_AGENT_GUARD_TIMEOUT_MS.
const REQUEST_TIMEOUT_MS = (() => {
  const raw = process.env.JF_AGENT_GUARD_TIMEOUT_MS;
  const n = raw ? Number(raw) : 30_000;
  return Number.isFinite(n) && n > 0 ? n : 30_000;
})();
// `jf config export` reads local state, so the network budget does not apply
// to it. Keep a floor so a short JF_AGENT_GUARD_TIMEOUT_MS (used to exercise
// request timeouts) cannot make the credential read time out instead.
const CONFIG_READ_TIMEOUT_MS = Math.max(REQUEST_TIMEOUT_MS, 10_000);
const JF_WRAPPER_SLACK_MS = 1000;
const HINT_MAX_CHARS = 160;
const JF_CREDENTIAL_ENV = [
  "JFROG_URL",
  "JF_URL",
  "JFROG_ACCESS_TOKEN",
  "JF_ACCESS_TOKEN",
  "JFROG_USER",
  "JF_USER",
  "JFROG_PASSWORD",
  "JF_PASSWORD",
];
const JF_HOME_BIN_DIR = join(homedir(), ".jfrog", "bin");
const JF_HOME_BINS = (
  process.platform === "win32" ? ["jf.exe", "jf.cmd", "jf.bat"] : ["jf"]
).map((name) => join(JF_HOME_BIN_DIR, name));

const debugEnabled = process.env.JF_AGENT_GUARD_DEBUG === "true";
const debug = (message) => {
  if (debugEnabled) console.error(`[jfrog-agent-guard] ${message}`);
};

// New JFROG_* env vars take precedence over the legacy JF_* names.
const env = (newName, oldName) =>
  process.env[newName] ?? (oldName ? process.env[oldName] : undefined);

const GATE_DONE = Symbol("gateDone");

const enabled = (reason) => {
  process.stdout.write(`Enabled: ${reason}\n`);
  process.exitCode = 0;
  throw GATE_DONE;
};

const unknown = (reason) => {
  process.stdout.write(`Unknown: ${reason}\n`);
  process.exitCode = 1;
  throw GATE_DONE;
};

// Reachable platform that reports the MCP registry turned off. Distinct exit
// code so the skill can tell this definitive answer apart from an undetermined
// status.
const registryDisabled = (reason) => {
  process.stdout.write(`RegistryDisabled: ${reason}\n`);
  process.exitCode = 2;
  throw GATE_DONE;
};

// Multiple configured servers, none default, no env creds: ask the user to
// pick one instead of a misleading Unknown. Ids are appended for the skill.
const ambiguousServer = (serverIds) => {
  process.stdout.write(
    `AmbiguousServer: multiple jf config servers exist but none is marked ` +
      `default; ask the user which to use, then re-run with <SERVER_ID>: ` +
      `${serverIds.join(", ")}\n`,
  );
  process.exitCode = 3;
  throw GATE_DONE;
};

// Exactly one positional argv[2]. Extras (argv[3..]), flags, and URLs are
// ALWAYS caller bugs — stop the gate immediately so a multi-JPD setup does
// not report the wrong platform's state. Everything else is treated as a
// candidate jf config server id — including hostname-shaped values and ids
// with spaces — because a text pattern cannot separate a real jf id from
// an MCP package name. jf config is the source of truth (see
// resolveCredentials).
function readGateServerId() {
  const extra = process.argv.slice(3);
  if (extra.length > 0) {
    unknown(
      `expected zero or one positional jf config server id, got extra ` +
        `argument(s) ${JSON.stringify(extra)} — the gate accepts only ` +
        `\`<SERVER_ID>\` positionally, with no flags or additional values ` +
        `after it`,
    );
  }
  const raw = process.argv[2];
  if (raw === undefined) return undefined;
  const id = String(raw).trim();
  if (!id) return undefined;
  if (id.startsWith("-")) {
    unknown(
      `expected a jf config server id (positional), got flag ` +
        `${JSON.stringify(id)} — pass \`<SERVER_ID>\` positionally, not as \`--server\``,
    );
  }
  if (/:\/\//.test(id)) {
    unknown(
      `expected a jf config server id (positional), got URL ` +
        `${JSON.stringify(id)} — do not derive an id from \`JFROG_URL\` / \`JF_URL\``,
    );
  }
  return id;
}

// Resolve credentials from Path A (environment variables) or Path B
// (the default JFrog CLI configuration). Returns
// { baseUrl, token?, user?, password?, source, serverId? } or null when
// neither path yields a usable URL plus a token or user+password.
// `serverId` is set only for Path B and is passed to `jf api --server-id`.
function resolveCredentials() {
  const explicitServerId = readGateServerId();
  // When the caller names a specific server, honor it or stop. Do not fall
  // back to env credentials or the default jf server, that would check a
  // different JPD in a multi-server setup when the named id is wrong (typo,
  // MCP package name, unknown id).
  if (explicitServerId) {
    const fromCli = resolveFromCliConfig(explicitServerId);
    if (fromCli) return fromCli;
    unknown(
      `server id ${JSON.stringify(explicitServerId)} is not configured in ` +
        `\`jf config\` (or \`jf\` is unavailable) — refusing to check a different JPD`,
    );
  }

  // Path A — environment variables. Token or user+password, same as Path B.
  const envUrl = env("JFROG_URL", "JF_URL");
  const envToken = env("JFROG_ACCESS_TOKEN", "JF_ACCESS_TOKEN");
  const envUser = env("JFROG_USER", "JF_USER");
  const envPassword = env("JFROG_PASSWORD", "JF_PASSWORD");
  if (envUrl && (envToken || (envUser && envPassword))) {
    debug("Using credentials from environment variables (Path A).");
    return {
      baseUrl: envUrl,
      ...(envToken ? { token: envToken } : {}),
      ...(envUser && envPassword ? { user: envUser, password: envPassword } : {}),
      source: "environment variables",
    };
  }
  debug(
    "Environment credentials incomplete; trying JFrog CLI config (Path B).",
  );

  // Path B — default server from the local JFrog CLI configuration.
  const credsFromDefaultServer = resolveFromCliConfig(undefined);
  if (credsFromDefaultServer) return credsFromDefaultServer;

  // The default export yielded no usable bearer credentials. `jf config export`
  // cannot list servers, so enumerate them separately to classify the failure.
  const configuredServers = listConfiguredServers();
  const serverIds = configuredServers.map((server) => server.serverId);
  const hasDefaultServer = configuredServers.some((server) => server.isDefault);

  // Exactly one server: unambiguous — use it even if not marked default.
  if (serverIds.length === 1) {
    debug(`No default server, but exactly one configured ('${serverIds[0]}'); using it.`);
    const credsFromOnlyServer = resolveFromCliConfig(serverIds[0]);
    if (credsFromOnlyServer) return credsFromOnlyServer;
  }

  // Two+ servers with NONE marked default: genuinely ambiguous — ask the user.
  // If a default IS marked but its credentials did not resolve above, that is
  // an unknown result (fall through to null), not ambiguity.
  if (serverIds.length > 1 && !hasDefaultServer) {
    debug(`No default server and ${serverIds.length} configured; needs user selection.`);
    return { needsServerSelection: true, serverIds };
  }
  return null;
}

// Configured servers ({ serverId, isDefault }) from `jf config show
// --format=json` (needs no default, masks tokens). Returns [] when jf is
// unavailable or nothing is configured.
function listConfiguredServers() {
  let showOutput;
  try {
    showOutput = execFileSync("jf", ["config", "show", "--format=json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch (error) {
    debug(`'jf config show --format=json' failed: ${error?.message}`);
    return [];
  }
  let servers;
  try {
    servers = JSON.parse(showOutput);
  } catch (error) {
    debug(`Could not parse 'jf config show --format=json' output: ${error?.message}`);
    return [];
  }
  if (!Array.isArray(servers)) return [];
  return servers
    .filter(
      (server) =>
        server && typeof server.serverId === "string" && server.serverId.trim(),
    )
    .map((server) => ({
      serverId: server.serverId.trim(),
      isDefault: server.isDefault === true,
    }));
}

function resolveFromCliConfig(serverId) {
  // `jf config export [server ID]` emits the server as a base64-encoded JSON
  // blob containing url, accessToken or user+password, and serverId. An
  // optional server ID may be passed; without it the CLI's default server is
  // used. We use the CLI rather than reading ~/.jfrog/jfrog-cli.conf.v6
  // directly because newer CLIs do not persist the access token in that file.
  const exportArgs = serverId ? ["config", "export", serverId] : ["config", "export"];
  let exported;
  try {
    exported = runJf(exportArgs, {
      timeoutMs: CONFIG_READ_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    // Do not fall back to ambient env credentials when an explicit server ID
    // is unsafe for a Windows shell. That could check a different JPD than
    // the one the caller requested.
    if (serverId && error?.code === "EINVAL") throw error;
    debug(
      `'jf config export' failed (jf not on PATH or no server configured): ${error?.message}`,
    );
    return null;
  }

  let cfg;
  try {
    cfg = JSON.parse(Buffer.from(exported, "base64").toString("utf8"));
  } catch (error) {
    debug(`Could not decode the jf config export token: ${error?.message}`);
    return null;
  }

  // `url` must be the platform root for /ml/core; a server missing it
  // (for example, added with --artifactory-url only) is unusable.
  const baseUrl = typeof cfg?.url === "string" ? cfg.url : "";
  const token = typeof cfg?.accessToken === "string" ? cfg.accessToken : "";
  const user = typeof cfg?.user === "string" ? cfg.user : "";
  const password = typeof cfg?.password === "string" ? cfg.password : "";
  if (!baseUrl) {
    debug(
      "Exported JFrog CLI config has no platform URL; re-run /jfrog-init to configure one.",
    );
    return null;
  }
  if (!token && !(user && password)) {
    debug("Exported JFrog CLI config has no access token or user+password.");
    return null;
  }

  // Only pass a real server ID through to `jf api --server-id`. The display
  // fallback "default" is not a jf server name and would make jf reject the
  // call as "Server ID 'default' does not exist".
  const id = serverId || cfg?.serverId;
  return {
    baseUrl,
    ...(token ? { token } : {}),
    ...(user && password ? { user, password } : {}),
    ...(id ? { serverId: id } : {}),
    source: `JF CLI config (server '${id || "default"}')`,
  };
}

function resolveJfPath() {
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const names =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .map((ext) => "jf" + ext.toLowerCase())
      : process.env.JF_AGENT_GUARD_TEST_CMD_SHIM === "true"
        ? ["jf", "jf.cmd", "jf.bat"]
        : ["jf"];
  for (const dir of dirs) {
    for (const name of names) {
      const full = join(dir, name);
      try {
        accessSync(
          full,
          process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
        );
        return full;
      } catch {
        // keep looking
      }
    }
  }
  if (process.env.JF_AGENT_GUARD_NO_SELF_HEAL !== "true") {
    for (const candidate of JF_HOME_BINS) {
      try {
        accessSync(
          candidate,
          process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
        );
        return candidate;
      } catch {
        // Keep looking for a usable fixed-location fallback.
      }
    }
  }
  return "";
}

function runJf(args, { timeoutMs, extraEnv, unsetEnv = [], stdio } = {}) {
  const jfPath = resolveJfPath() || "jf";
  const needsShell = /\.(cmd|bat)$/i.test(jfPath);
  let shellCommand;
  if (needsShell) {
    // cmd.exe tokenizes the joined command line. Quote the executable so a
    // path with spaces (e.g. `C:\Program Files\...\jf.cmd`) stays one token,
    // and reject metacharacters in both the path and the args.
    // `\` is a Windows path separator — do not treat it as unsafe in jfPath.
    // Args reject `%` because cmd expands `%VAR%` even inside double quotes
    // (a URL like `https://jpd.example/%2F` would mutate before jf saw
    // --url). Backslash is safe inside these quoted cmd.exe arguments and is
    // needed for Windows client-certificate paths.
    const unsafe =
      /[&|;$<>`"'%^!\r\n]/.test(jfPath) ||
      args.some((a) => /[&|;$<>`"'%^!\r\n]/.test(a));
    if (unsafe) {
      const err = new Error("refusing shell-unsafe jf argument");
      err.code = "EINVAL";
      throw err;
    }
    // Build one fully quoted command string. Passing an args array together
    // with shell:true is deprecated in recent Node versions and would still
    // rely on Node's unescaped space-joining.
    shellCommand = [`"${jfPath}"`, ...args.map((a) => `"${a}"`)].join(" ");
  }
  const childEnv = { ...process.env };
  for (const name of unsetEnv) delete childEnv[name];
  Object.assign(childEnv, extraEnv);
  const options = {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: stdio ?? ["ignore", "pipe", "pipe"],
    env: childEnv,
  };
  if (needsShell) {
    return execSync(shellCommand, {
      ...options,
      shell:
        process.platform === "win32"
          ? process.env.ComSpec || "cmd.exe"
          : "/bin/sh",
    });
  }
  return execFileSync(jfPath, args, options);
}

function stripUrlUserinfo(baseUrl) {
  let value = String(baseUrl || "").replace(/\/+$/, "");
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
      value = parsed.toString().replace(/\/+$/, "");
    }
  } catch {
    // Leave non-standard URL forms unchanged for jf to validate.
  }
  return value;
}

function normalizePlatformRoot(baseUrl) {
  let root = stripUrlUserinfo(baseUrl);
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const suffix of ["/artifactory", "/ui"]) {
      if (root.endsWith(suffix)) {
        root = root.slice(0, -suffix.length);
        stripped = true;
      }
    }
  }
  return root;
}

function sanitizeHint(hint, secrets) {
  let text = String(hint || "").trim();
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  if (text.length > HINT_MAX_CHARS) text = `${text.slice(0, HINT_MAX_CHARS - 3)}...`;
  return text;
}

function jsonFromJfStdout(stdout) {
  const cleaned = String(stdout || "")
    .split("\n")
    .filter((line) => !line.includes("[Info]") && !line.includes("[Warn]"))
    .join("\n")
    .trim();
  return cleaned ? JSON.parse(cleaned) : null;
}

// `jf api` writes `[Info] Http Status: NNN` (and on non-2xx, `[Warn] ...
// returned NNN`) to stderr. Last match wins so a retry/log line can't hide
// the actual status. 0 means "couldn't determine a status" — treat as
// unreachable, not as HTTP 0.
function parseHttpStatus(text) {
  let status = 0;
  for (const line of String(text || "").split("\n")) {
    const http = line.match(/Http Status:\s*(\d+)/);
    if (http) {
      status = Number(http[1]);
      continue;
    }
    const returned = line.match(/\breturned\s+(\d{3})\b/);
    if (returned) status = Number(returned[1]);
  }
  return status;
}

function jfFailure(error) {
  const stdout = error?.stdout ? error.stdout.toString() : "";
  const stderr = error?.stderr
    ? error.stderr.toString()
    : error?.code === "EINVAL"
      ? String(error.message || "")
      : "";
  const timedOut = error?.code === "ETIMEDOUT" || error?.killed === true;
  return {
    ok: false,
    stdout,
    stderr,
    status: parseHttpStatus(stderr) || parseHttpStatus(stdout),
    timedOut,
    missing: error?.code === "ENOENT",
  };
}

function runJfApi(args, extraEnv, unsetEnv) {
  try {
    // jf's own --timeout is in seconds; keep the Node wrapper slightly
    // longer so a slow JPD surfaces as jf's timeout, not a SIGTERM.
    const stdout = runJf(["api", ...args], {
      timeoutMs: REQUEST_TIMEOUT_MS + JF_WRAPPER_SLACK_MS,
      extraEnv: {
        ...extraEnv,
        // Avoid a second proxy-sensitive wait after the settings response.
        JFROG_CLI_REPORT_USAGE: "false",
      },
      unsetEnv,
    });
    return { ok: true, stdout, stderr: "" };
  } catch (error) {
    return jfFailure(error);
  }
}

async function fetchGatewayPluginEnabled(url, creds) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const authorization = creds.token
    ? `Bearer ${creds.token}`
    : `Basic ${Buffer.from(`${creds.user}:${creds.password}`).toString("base64")}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      debug(`Settings request returned HTTP ${response.status}.`);
      return {
        ok: false,
        notFound: response.status === 404,
        reason: `settings endpoint returned HTTP ${response.status}`,
      };
    }
    const data = await response.json();
    return gatewaySettingFromBody(data);
  } catch (error) {
    const reason =
      error?.name === "AbortError" ? "timeout" : error?.message ?? "unknown error";
    debug(`Settings request failed: ${reason}`);
    return { ok: false, reason: `settings endpoint unreachable (${reason})` };
  } finally {
    clearTimeout(timeout);
  }
}

function gatewaySettingFromBody(data) {
  // Be tolerant about where and how the flag is carried, so a shape/casing
  // change on the platform side can't turn a genuinely-enabled registry into
  // a false "disabled" (exit 1). The endpoint URL already names the setting
  // (`.../mcp_gateway_plugin_enabled`), so the body may arrive as any of:
  //   - `{ settings: { mcpGatewayPluginEnabled: <bool|{value}> } }` (wrapped);
  //   - the same at the top level, un-wrapped;
  //   - `{ value: <bool> }` (bare wrapper, key implied by the URL);
  //   - a bare boolean `true` / `false`.
  // Casing: the path segment is snake_case while JFrog JSON bodies are
  // typically camelCase — accept either.
  const unwrap = (v) =>
    v !== null && typeof v === "object" ? v?.value : v;
  const container = data?.settings ?? data;
  const named =
    container?.mcpGatewayPluginEnabled ??
    container?.mcp_gateway_plugin_enabled;
  // `named` first (explicit key), then the bare wrapper / bare boolean forms.
  const value =
    typeof data === "boolean"
      ? data
      : named !== undefined
        ? unwrap(named)
        : unwrap(container);
  debug(`Settings response indicates gateway plugin enabled=${value}.`);
  if (value === true) return { ok: true };
  if (value === false) {
    return {
      ok: false,
      registryOff: true,
      reason: "mcp gateway plugin setting returned false",
    };
  }
  return {
    ok: false,
    reason: "settings endpoint returned an invalid gateway-plugin setting",
  };
}

/** Drops the internal `notFound` marker from a fetchSetting() result. */
function strip({ notFound: _notFound, ...result }) {
  return result;
}

async function isGatewayPluginEnabled(creds) {
  const rootResult = await fetchSetting(SETTINGS_PATH, creds);
  if (!rootResult.notFound) return strip(rootResult);

  // Root 404 -> possibly self-hosted, where the same API sits behind
  // `/bridge-client`. Both transports below start a fresh attempt (a new
  // `jf api` process, or a new AbortController), so the retry never inherits
  // a spent timeout budget.
  debug(
    `Root ${SETTINGS_PATH} returned 404; retrying behind ${BRIDGE_CLIENT_PREFIX}.`,
  );
  const bridgeResult = await fetchSetting(
    BRIDGE_CLIENT_PREFIX + SETTINGS_PATH,
    creds,
  );
  // Bridge may only UPGRADE the verdict; anything else keeps the root result,
  // so every pre-existing reason string and exit code is untouched.
  if (bridgeResult.ok || bridgeResult.registryOff) return strip(bridgeResult);
  return strip(rootResult);
}

// One attempt against `settingsPath` — over `jf api` when a server is
// selected, a direct request otherwise. `notFound` marks the 404 that
// triggers the `/bridge-client` retry; callers strip it before returning.
async function fetchSetting(settingsPath, creds) {
  // Status mapping: HTTP 200 + value:false → exit 2; 401/403 / other
  // non-2xx → exit 1; unreachable → exit 1. `jf api` prints
  // "Http Status: NNN" on stderr and the body on stdout.
  const root = normalizePlatformRoot(creds.baseUrl);
  const settingsUrl = root + settingsPath;
  if (!creds.serverId) {
    debug(`No jf server configured; requesting ${settingsUrl} directly.`);
    return fetchGatewayPluginEnabled(settingsUrl, creds);
  }
  debug(`Fetching gateway plugin setting via jf api (server '${creds.serverId}')`);
  const call = runJfApi(
    [
      "--timeout",
      String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)),
      "--server-id",
      creds.serverId,
      "-H",
      "Accept: application/json",
      settingsPath,
    ],
    undefined,
    // Do not let incomplete or stale ambient credentials override the
    // explicitly selected server.
    JF_CREDENTIAL_ENV,
  );
  // A CLI older than 2.100.0 has no `jf api`: the unknown-command failure
  // carries no HTTP status, so treat it like a missing CLI rather than an
  // unreachable platform, and use the direct request instead.
  const unsupported =
    !call.ok &&
    !call.status &&
    /is not a jf command|unknown command/i.test(
      `${call.stderr || ""}\n${call.stdout || ""}`,
    );
  if (call.missing || unsupported) {
    debug("jf unusable for 'jf api'; falling back to fetch().");
    return fetchGatewayPluginEnabled(settingsUrl, creds);
  }
  if (call.timedOut) {
    try {
      const data = jsonFromJfStdout(call.stdout);
      if (data !== null) {
        const completed = gatewaySettingFromBody(data);
        if (completed.ok || completed.registryOff) return completed;
      }
    } catch {
      // Partial stdout is expected when Node terminates a timed-out process.
    }
    debug("Settings request timed out.");
    return { ok: false, reason: "settings endpoint unreachable (timeout)" };
  }
  if (!call.ok) {
    if (call.status) {
      debug(`Settings request returned HTTP ${call.status}.`);
      // Non-OK (incl. 401/403) means an auth/permission/transport problem, NOT
      // a deliberately-disabled registry — stay silent (exit 1) rather than
      // sending the user to IT. Only HTTP 200 + value:false is "disabled".
      return {
        ok: false,
        notFound: call.status === 404,
        reason: `settings endpoint returned HTTP ${call.status}`,
      };
    }
    const rawHint = (call.stderr || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .at(-1);
    const hint = sanitizeHint(rawHint, [creds.token, creds.password]);
    debug(`Settings request failed: ${hint || "jf api failed"}`);
    return {
      ok: false,
      reason: `settings endpoint unreachable (${hint || "jf api failed"})`,
    };
  }

  let data;
  try {
    data = jsonFromJfStdout(call.stdout);
  } catch (error) {
    debug(`Could not parse settings JSON: ${error?.message}`);
    return {
      ok: false,
      reason: "settings endpoint returned an invalid gateway-plugin setting",
    };
  }
  if (data === null) {
    return {
      ok: false,
      reason: "settings endpoint returned an invalid gateway-plugin setting",
    };
  }
  return gatewaySettingFromBody(data);
}

async function main() {
  // Fail up front on Node < 18 with an explicit reason.
  const nodeMajor = Number.parseInt(process.versions.node, 10);
  if (Number.isFinite(nodeMajor) && nodeMajor < MIN_NODE_MAJOR) {
    unknown(
      `requires Node.js ${MIN_NODE_MAJOR} or newer (detected ${process.version})`,
    );
    return;
  }

  // Manual overrides bypass credential resolution and the network call
  // entirely. Checked first, in this order, so a conflicting config fails
  // safe (disabled) rather than silently favoring enablement.
  const forceDisabled =
    env("_JF_AGENT_GUARD_FORCE_DISABLE") === "true";
  const forceEnabled =
    env("JF_AGENT_GUARD_FORCE_ENABLE") === "true";
  if (forceDisabled) {
    registryDisabled("forced via _JF_AGENT_GUARD_FORCE_DISABLE");
    return;
  }
  if (forceEnabled) {
    enabled("forced via JF_AGENT_GUARD_FORCE_ENABLE");
    return;
  }

  const creds = resolveCredentials();
  if (!creds) {
    unknown(
      "JFROG_URL/JF_URL + credentials not set and no default JF CLI config found",
    );
    return;
  }
  if (creds.needsServerSelection) {
    ambiguousServer(creds.serverIds);
    return;
  }

  const result = await isGatewayPluginEnabled(creds);
  if (result.ok) {
    enabled(`via ${creds.source}`);
    return;
  }
  if (result.registryOff) {
    registryDisabled(result.reason);
    return;
  }
  unknown(result.reason);
}

try {
  await main();
} catch (error) {
  if (error === GATE_DONE) {
    // Intentional halt after a diagnostic write. Lets stdout drain.
  } else {
    // Last-resort guard: any unexpected throw must NOT leak a stack trace to the
    // user (the skill's Step 0 is silent). Downgrade to the safe "unknown" exit.
    debug(`Unexpected error: ${error?.stack ?? error?.message ?? error}`);
    try {
      unknown(
        error?.code === "EINVAL"
          ? "JF CLI argument rejected as shell-unsafe"
          : "unexpected error",
      );
    } catch (halt) {
      if (halt !== GATE_DONE) throw halt;
    }
  }
}
