#!/usr/bin/env node
// Resolves which jf server ID to use, in this order:
//   1. First positional arg, if non-empty
//   2. JF_SERVER_ID env var, if non-empty
//   3. The server marked "isDefault": true in ~/.jfrog/jfrog-cli.conf.v6
//      (via `jf c show --format=json`)
//   4. If exactly one server is configured, it is used silently.
//
// This is the single source of truth for server-id resolution — every
// script that needs a server-id (server-ping, catalog-runtime, project,
// detect-all, the mcp-placeholder substituter) MUST resolve through this
// function rather than re-deriving the fallback chain, so they always
// agree on which server is "the" server on a multi-server machine.
//
// Returns the resolved server ID, or "" if multiple servers are
// configured, none is marked default, and no override was given —
// callers must then ask the user (never invent a server, never rely on
// `jf`'s own fallback).
//
// CLI usage: node jfrog-resolve-jf-server.mjs [override]
//   Exit 0 -> a server ID was resolved; printed on stdout
//   Exit 1 -> could not resolve (no override, no default marked, >1 server)

import { emit, isMainModule, jfAvailable, jfConfigShow, defaultServerId, emitNoServerResolved, describeJfUnavailable } from "./lib/jf.mjs";

// `runJf()` (lib/jf.mjs) passes `--server-id=${serverId}` to `execFileSync`
// as a real array element, never through a shell — so a serverId
// containing spaces or punctuation reaches `jf` as one argument, exactly
// as typed, with no injection surface to defend against here. This used
// to validate the id against an allowlist, then a denylist, on the
// assumption that "real jf server IDs are always a plain identifier" —
// that's false: `jf config add "my server" --interactive=false` succeeds
// and writes `"serverId": "my server"`, and jf enforces no charset of its
// own. Either list rejected realistic ids (spaces, parens from an
// auto-disambiguated id like "dev(1)", etc.) exactly like it would reject
// a genuinely dangerous one, so resolution silently failed closed on a
// perfectly normal setup — misreported by callers as "multiple servers,
// none resolved" instead of the real cause. Now that runJf() no longer
// goes through a shell, there is nothing left for a charset check here to
// protect against.
export function resolveJfServer(override, configList) {
  const picked = override || process.env.JF_SERVER_ID || "";
  if (picked) return picked;
  // Every caller that passes `configList` has already called jfAvailable()
  // itself to get there (see jfrog-detect-*.mjs) — re-checking here would
  // just spawn a second, redundant `jf --version`. Only the standalone
  // CLI usage below (no configList) still needs this script to check.
  if (configList === undefined && !jfAvailable()) return "";
  const list = configList || jfConfigShow();
  const fromDefault = defaultServerId(list);
  if (fromDefault) return fromDefault;
  if (list.length === 1 && list[0].serverId) {
    return list[0].serverId;
  }
  return "";
}

// Shared "jf installed? → read config → resolve server-id → ask if
// ambiguous" preamble — every jfrog-detect-*.mjs that takes an optional
// [server-id] argument (server-ping, catalog-runtime, project) needs the
// exact same four steps; only the status/exit code for "jf not installed"
// differs between them, so that's the one thing callers still pick.
// Returns { serverId, configList, exitCode } — exitCode is non-null (and
// already emitted) when the caller should stop and return it as-is.
export function resolveServerOrEmit(check, argServerId, jfMissing) {
  if (!jfAvailable()) {
    emit({ check, status: jfMissing.status, detail: describeJfUnavailable() });
    return { serverId: null, configList: [], exitCode: jfMissing.exitCode };
  }
  const configList = jfConfigShow();
  const serverId = resolveJfServer(argServerId, configList);
  if (!serverId) {
    return { serverId: null, configList, exitCode: emitNoServerResolved(check, configList) };
  }
  return { serverId, configList, exitCode: null };
}

if (isMainModule(import.meta.url)) {
  const resolved = resolveJfServer(process.argv[2]);
  if (resolved) {
    process.stdout.write(resolved + "\n");
    process.exitCode = 0;
  } else {
    process.exitCode = 1;
  }
}
