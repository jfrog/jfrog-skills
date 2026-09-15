#!/usr/bin/env node
// Detects whether the JFrog CLI has a configured server. Reads ONLY the
// masked `jf config show` output — never `jf config export` (which would
// emit an access token), so this script never sees or logs a token.
//
// Idempotent, read-only, zero mutation. Emits one JSON line to stdout.
//
// Exit 0 -> green (at least one server configured)
// Exit 1 -> red   (jf missing, or no server configured)

import { emit, isMainModule, jfAvailable, jfConfigShow, describeJfUnavailable } from "./lib/jf.mjs";

// Exported so jfrog-detect-all.mjs can call this in-process instead of
// shelling out to a `node` subprocess and re-parsing its stdout — the
// same in-process pattern jfrog-resolve-jf-server.mjs /
// jfrog-resolve-mcp-config.mjs / jfrog-substitute-mcp-placeholders.mjs
// use. The CLI entry point below is a thin wrapper around this function.
export function detectJfConfig() {
  if (!jfAvailable()) {
    emit({ check: "jf-config", status: "red", detail: describeJfUnavailable() });
    return 1;
  }
  const servers = jfConfigShow();
  if (servers.length > 0) {
    emit({ check: "jf-config", status: "green", detail: `${servers.length} server(s) configured` });
    return 0;
  }
  emit({ check: "jf-config", status: "red", detail: "no jf server configured" });
  return 1;
}

// Sets process.exitCode rather than calling process.exit() — a forced
// exit can truncate the JSON line's stdout write if it's still draining
// through a pipe.
if (isMainModule(import.meta.url)) {
  process.exitCode = detectJfConfig();
}
