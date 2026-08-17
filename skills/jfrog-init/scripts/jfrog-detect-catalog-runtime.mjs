#!/usr/bin/env node
// AI Catalog readiness check for the current user + JPD, against
// <JPD>/ml/core/api/v1/mcp-registry/ml-projects?pageSize=1 — this skill
// does NOT read a separate JFROG_PLATFORM_URL / JFROG_URL env var; the
// source of truth is what `jf` itself is configured with.
//
// Two sub-checks, both must pass (mirrors jfrog-detect-server-ping.mjs's
// reachability/credentials split):
//   Part A — anonymous: proves the endpoint is deployed at this JPD at
//     all, independent of this user's entitlement. 2xx/401/403/405/406 =
//     up; 404 / connection failure = red, and Part B is skipped.
//   Part B — authenticated, with the bearer token (or user+password)
//     extracted from `jf config export` — same credential source `jf`
//     itself uses. The token exists in memory for the duration of one
//     fetch call and is never echoed, logged, or written to disk. NO
//     env-var fallback. 2xx = user is entitled to read the AI Catalog.
//
// Splitting reachability from entitlement produces two distinct outcomes:
// Part A red = "this JPD doesn't host AI Catalog" (blocking); Part B
// 401/403 = "catalog is up but your user isn't entitled" (non-blocking —
// see status "not_entitled" / exit 4 below).
//
// Idempotent, read-only, zero mutation. Emits one JSON line.
//
// Usage: node jfrog-detect-catalog-runtime.mjs [server-id]
//
// Exit 0 -> green        (catalog deployed AND user entitled)
// Exit 1 -> red          (no jf servers configured, no credentials, JPD
//                         doesn't host AI Catalog, unreachable, or a 5xx —
//                         mirrors jfrog-detect-server-ping.mjs's treatment
//                         of the same "backend is erroring" code class).
//                         This script itself still reports it as "red" —
//                         but jfrog-detect-all.mjs, the one caller that
//                         orchestrates the full walk, treats this exit
//                         code as NON-BLOCKING same as exit 4 below (see
//                         that file's header comment and
//                         references/catalog-runtime-branches.md):
//                         Steps 1-4 don't depend on the AI Catalog
//                         existing at all.
// Exit 2 -> ask          (multiple servers configured, none resolvable —
//                         caller must prompt the user and re-invoke with
//                         the picked server-id)
// Exit 3 -> error        (jf missing, credentials rejected with a 401, or a
//                         non-5xx unexpected HTTP code)
// Exit 4 -> not_entitled (catalog reachable, but the user isn't entitled
//                         — NON-BLOCKING: the rest of the setup is
//                         unaffected; this is a permissions gap for the
//                         user's admin to fix, not a broken setup)

import { emit, isMainModule, resolveCreds, urlForServer, normalizeJpdUrl, authedFetch, anonymousFetchStatus, NETWORK_UNREACHABLE_HINT } from "./lib/jf.mjs";
import { resolveServerOrEmit } from "./jfrog-resolve-jf-server.mjs";

const CATALOG_PATH = "/ml/core/api/v1/mcp-registry/ml-projects?pageSize=1";

// Shared by both Part A (anonymous) and Part B (authenticated) below — each
// probe can independently come back "000" (connection failed) or "404"
// (this JPD doesn't host the AI Catalog), and both cases must report the
// exact same wording regardless of which probe hit it.
function emitUnreachable(endpoint) {
  emit({ check: "catalog", status: "red", detail: `catalog unreachable at ${endpoint}: connection failed${NETWORK_UNREACHABLE_HINT}` });
  return 1;
}
function emitNotHosted(endpoint) {
  emit({ check: "catalog", status: "red", detail: `catalog endpoint returned 404 at ${endpoint} — this JPD may not host the AI Catalog` });
  return 1;
}
// A 5xx means the backend itself is erroring, same as a connection failure
// from the caller's perspective — treat it as "red", not "error", so it
// matches jfrog-detect-server-ping.mjs's classification of the same code
// class rather than being misreported as a config/environment problem.
function emitServerError(endpoint, httpCode) {
  emit({ check: "catalog", status: "red", detail: `catalog probe returned HTTP ${httpCode} (server error) at ${endpoint}` });
  return 1;
}

// Exported so jfrog-detect-all.mjs can call this in-process instead of
// shelling out to a `node` subprocess and re-parsing its stdout — the
// same in-process pattern jfrog-resolve-jf-server.mjs /
// jfrog-resolve-mcp-config.mjs / jfrog-substitute-mcp-placeholders.mjs
// use. The CLI entry point below is a thin wrapper around this function.
//
// Every branch below emits exactly once and returns the exit code rather
// than calling process.exit() — a forced exit can truncate the JSON line
// (e.g. the "ask" payload's candidates list) if stdout is still draining
// through a pipe.
export async function detectCatalogRuntime(serverIdArg) {
  const resolved = resolveServerOrEmit("catalog", serverIdArg, { status: "error", exitCode: 3 });
  if (resolved.exitCode !== null) {
    return resolved.exitCode;
  }
  const { serverId, configList } = resolved;

  const url = normalizeJpdUrl(urlForServer(configList, serverId));
  if (!url) {
    emit({ check: "catalog", status: "red", detail: `no url found in jf config for server-id=${serverId}` });
    return 1;
  }
  const endpoint = `${url}${CATALOG_PATH}`;

  // ---------- Part A: anonymous reachability ----------
  const anonCode = await anonymousFetchStatus(endpoint);

  if (anonCode === "000") {
    return emitUnreachable(endpoint);
  }
  if (anonCode === "404") {
    return emitNotHosted(endpoint);
  }
  if (/^5/.test(anonCode)) {
    return emitServerError(endpoint, anonCode);
  }
  if (!/^2/.test(anonCode) && !/^3/.test(anonCode) && !["401", "403", "405", "406"].includes(anonCode)) {
    emit({ check: "catalog", status: "error", detail: `catalog probe returned unexpected HTTP ${anonCode} at ${endpoint}` });
    return 3;
  }

  // ---------- Part B: authenticated entitlement (token from `jf config`) ----------
  const creds = resolveCreds(serverId);

  if (!creds) {
    emit({
      check: "catalog",
      status: "red",
      detail: "cannot authenticate to AI Catalog: no access token or user+password found in jf config. Re-run `jf config add --interactive`.",
    });
    return 1;
  }

  const { code, body } = await authedFetch(creds, CATALOG_PATH);
  const httpCode = code === 0 ? "000" : String(code);

  // A 2xx status alone isn't proof this is really the AI Catalog endpoint —
  // a captive portal or misrouted network can also answer 200. Require the
  // expected shape (an object with a `projectKeys` array) too.
  const looksLikeCatalog = body && typeof body === "object" && Array.isArray(body.projectKeys);

  if (httpCode.startsWith("2") && looksLikeCatalog) {
    emit({ check: "catalog", status: "green", detail: `catalog reachable, user entitled (HTTP ${httpCode})` });
    return 0;
  }
  if (httpCode.startsWith("2") && !looksLikeCatalog) {
    emit({ check: "catalog", status: "error", detail: `got HTTP ${httpCode} from ${endpoint} but the response wasn't the expected AI Catalog shape — this may not be the JPD's real endpoint (captive portal / proxy?)` });
    return 3;
  }
  if (httpCode === "000") {
    return emitUnreachable(endpoint);
  }
  if (httpCode === "401") {
    // Unlike 403, a 401 means the credentials themselves were rejected —
    // this says nothing about entitlement, so it must not be folded into
    // the non-blocking "not_entitled" outcome below.
    emit({
      check: "catalog",
      status: "error",
      detail: `cannot authenticate to AI Catalog: /access rejected the credentials in jf config (HTTP 401). Re-run \`jf config add --interactive\`.`,
    });
    return 3;
  }
  if (httpCode === "403") {
    emit({
      check: "catalog",
      status: "not_entitled",
      detail: `catalog reachable but your user is not entitled to read the AI Catalog (HTTP ${httpCode}). Contact your JFrog admin and ask them to grant read access to /ml/core/api/v1/mcp-registry (typically the "AI Catalog Read" / "Application Admin" role on this JPD). This does not block the rest of your JFrog setup.`,
    });
    return 4;
  }
  if (httpCode === "404") {
    return emitNotHosted(endpoint);
  }
  if (/^5/.test(httpCode)) {
    return emitServerError(endpoint, httpCode);
  }

  emit({ check: "catalog", status: "error", detail: `catalog probe returned unexpected HTTP ${httpCode} at ${endpoint}` });
  return 3;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await detectCatalogRuntime(process.argv[2]);
}
