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
//   - exit 2 -> reachable but the platform has the MCP registry DISABLED
//               (skill should tell the user to contact their admin / IT)
//   - exit 1 -> DISABLED for any other reason: no credentials, timeout,
//               network/DNS error (skill must silently abort)
//   - a single human-readable reason line is written to stdout for
//     diagnostics only; Step 0 keys off the EXIT CODE, not the text.
//
// Set JF_AGENT_GUARD_DEBUG=true for verbose tracing on stderr.

import { execFileSync } from "node:child_process";
import process from "node:process";

const SETTINGS_PATH =
  "/ml/core/api/v1/administration/account-settings/mcp_gateway_plugin_enabled";
const REQUEST_TIMEOUT_MS = 5000;

const debugEnabled = process.env.JF_AGENT_GUARD_DEBUG === "true";
const debug = (message) => {
  if (debugEnabled) console.error(`[jfrog-agent-guard] ${message}`);
};

// New JFROG_* env vars take precedence over the legacy JF_* names.
const env = (newName, oldName) =>
  process.env[newName] ?? (oldName ? process.env[oldName] : undefined);

const enabled = (reason) => {
  process.stdout.write(`Enabled: ${reason}\n`);
  process.exit(0);
};

const disabled = (reason) => {
  process.stdout.write(`Disabled: ${reason}\n`);
  process.exit(1);
};

// Reachable platform that reports the MCP registry turned off. Distinct exit
// code so the skill can tell the user to contact their admin / IT.
const registryDisabled = (reason) => {
  process.stdout.write(`RegistryDisabled: ${reason}\n`);
  process.exit(2);
};

// Resolve credentials from Path A (environment variables) or Path B
// (the default JFrog CLI configuration). Returns { baseUrl, token, source }
// or null when neither path yields a usable URL + access token.
function resolveCredentials() {
  const explicitServerId = process.argv[2];
  // With an explicit server ID, try the named jf-config server FIRST so the
  // gate checks THAT JPD, not the ambient default. But if it does not resolve
  // (server not in jf config, jf absent/old), fall back to env credentials
  // rather than reporting a false "disabled" — the platform may be fully
  // reachable via exported JFROG_URL + token even with no matching jf server.
  if (explicitServerId) {
    const fromCli = resolveFromCliConfig();
    if (fromCli) return fromCli;
    debug(
      "Explicit server ID did not resolve via jf config; falling back to env credentials.",
    );
  }

  // Path A — environment variables.
  const envUrl = env("JFROG_URL", "JF_URL");
  const envToken = env("JFROG_ACCESS_TOKEN", "JF_ACCESS_TOKEN");
  if (envUrl && envToken) {
    debug("Using credentials from environment variables (Path A).");
    return { baseUrl: envUrl, token: envToken, source: "environment variables" };
  }
  debug(
    "Environment credentials incomplete; trying JFrog CLI config (Path B).",
  );

  // Path B — default server from the local JFrog CLI configuration. If an
  // explicit ID was given we already tried the CLI above (and env fell through),
  // so there is nothing left to resolve.
  if (explicitServerId) return null;
  return resolveFromCliConfig();
}

function resolveFromCliConfig() {
  // `jf config export [server ID]` emits the server as a base64-encoded JSON
  // blob containing url, accessToken, and serverId. An optional server ID may
  // be passed as argv[2]; without it the CLI's default server is used. We use
  // the CLI rather than reading ~/.jfrog/jfrog-cli.conf.v6 directly because
  // newer CLIs do not persist the access token in that file (and the platform
  // URL may be stored only as an /artifactory-suffixed URL there, which is
  // wrong for /ml/core).
  const serverId = process.argv[2];
  const exportArgs = serverId ? ["config", "export", serverId] : ["config", "export"];
  let exported;
  try {
    exported = execFileSync("jf", exportArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch (error) {
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

  // `url` is the platform/JPD root — the base the /ml/core settings path needs.
  const baseUrl = cfg?.url;
  const token = cfg?.accessToken;
  if (!baseUrl) {
    debug("Exported JFrog CLI config has no platform URL.");
    return null;
  }
  if (!token) {
    debug("Exported JFrog CLI config has no access token (bearer auth needed).");
    return null;
  }

  const id = cfg?.serverId ?? "default";
  return { baseUrl, token, source: `JF CLI config (server '${id}')` };
}

async function isGatewayPluginEnabled(baseUrl, token) {
  // Normalize to the platform root: drop trailing slashes and a trailing
  // `/artifactory` segment. Users commonly export JFROG_URL as
  // `https://myco.jfrog.io/artifactory`, but the settings path lives under
  // `/ml/core` off the platform root — without this, Path A would build
  // `.../artifactory/ml/core/...` and 404 into a false "disabled" (exit 1).
  const root = baseUrl.replace(/\/+$/, "").replace(/\/artifactory$/, "");
  const url = root + SETTINGS_PATH;
  debug(`Fetching gateway plugin setting from ${url}`);

  // Trade-off: we use a direct fetch() rather than `jf api` (the pattern other
  // scripts in this repo use for authenticated JFrog REST calls) because this
  // gate keys off exact HTTP status codes — 200+value:false vs 401/403 vs
  // unreachable each map to a different exit code — and parsing `jf api`'s
  // "[Warn] ... returned NNN" / "Http Status: NNN" stderr convention for that
  // is brittle. The cost: this call does NOT inherit any corporate-proxy or
  // custom-CA settings baked into the user's `jf` config, so an env that only
  // works through jf's transport can surface here as an unreachable/timeout
  // (exit 1). If that becomes common, switch to `jf api` and parse its status.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      debug(`Settings request returned HTTP ${response.status}.`);
      // Non-OK (incl. 401/403) means an auth/permission/transport problem, NOT
      // a deliberately-disabled registry — stay silent (exit 1) rather than
      // sending the user to IT. Only HTTP 200 + value:false is "disabled".
      return {
        ok: false,
        reason: `settings endpoint returned HTTP ${response.status}`,
      };
    }
    const data = await response.json();
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
  } catch (error) {
    const reason =
      error?.name === "AbortError" ? "timeout" : error?.message ?? "unknown error";
    debug(`Settings request failed: ${reason}`);
    return { ok: false, reason: `settings endpoint unreachable (${reason})` };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  // Manual overrides bypass credential resolution and the network call
  // entirely. Checked first, in this order, so a conflicting config fails
  // safe (disabled) rather than silently favoring enablement.
  const forceDisabled =
    env("_JF_AGENT_GUARD_FORCE_DISABLE") === "true";
  const forceEnabled =
    env("JF_AGENT_GUARD_FORCE_ENABLE") === "true";
  if (forceDisabled) {
    disabled("forced via _JF_AGENT_GUARD_FORCE_DISABLE");
    return;
  }
  if (forceEnabled) {
    enabled("forced via JF_AGENT_GUARD_FORCE_ENABLE");
    return;
  }

  const creds = resolveCredentials();
  if (!creds) {
    disabled(
      "JFROG_URL/JF_URL + access token not set and no default JF CLI config found",
    );
    return;
  }

  const result = await isGatewayPluginEnabled(creds.baseUrl, creds.token);
  if (result.ok) {
    enabled(`via ${creds.source}`);
    return;
  }
  if (result.registryOff) {
    registryDisabled(result.reason);
    return;
  }
  disabled(result.reason);
}

try {
  await main();
} catch (error) {
  // Last-resort guard: any unexpected throw must NOT leak a stack trace to the
  // user (the skill's Step 0 is silent). Downgrade to the safe "disabled" exit.
  debug(`Unexpected error: ${error?.stack ?? error?.message ?? error}`);
  disabled("unexpected error");
}
