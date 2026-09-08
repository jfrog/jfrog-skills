#!/usr/bin/env node
// Is the JFrog MCP server enabled on this JPD? One anonymous GET to <JPD>/mcp
// (URL from `jf config`). An enabled endpoint is OAuth-protected, so it answers
// with a "Bearer" auth challenge; a not-enabled one doesn't. Non-blocking.
//
// Cases:
//   enabled     (exit 0) server enabled (a 2xx or Bearer challenge) — NOT
//                        proof the user is signed in; caller checks the tools
//   not_enabled (exit 4) admin hasn't enabled it — a 404, or a bare 403
//   unreachable (exit 1) nothing we trust as enabled — 000, 5xx, a redirect,
//                        a 401 with no challenge; also resolver "red"
//   ask         (exit 2) server-id ambiguous — see resolveServerOrEmit
//   error       (exit 3) jf not installed, or no URL in jf config

import { emit, isMainModule, urlForServer, normalizeJpdUrl, anonymousFetch } from "./lib/jf.mjs";
import { resolveServerOrEmit } from "./jfrog-resolve-jf-server.mjs";

const DOCS_URL = "https://docs.jfrog.com/integrations/docs/enable-the-jfrog-mcp-server";
const HTTP_FORBIDDEN = "403";
const HTTP_NOT_FOUND = "404";

export async function detectJfrogMcpResponding(serverIdArg) {
  const { serverId, configList, exitCode } = resolveServerOrEmit("jfrog-mcp-responding", serverIdArg, { status: "error", exitCode: 3 });
  if (exitCode !== null) return exitCode;

  const url = normalizeJpdUrl(urlForServer(configList, serverId));
  if (!url) {
    emit({ check: "jfrog-mcp-responding", status: "error", detail: `no url found in jf config for server-id=${serverId}` });
    return 3;
  }
  const endpoint = `${url}/mcp`;
  const { status, headers } = await anonymousFetch(endpoint);
  // Enabled = OAuth-protected: it returns a "Bearer" challenge (or a 2xx if
  // already trusted). No challenge (a redirect, a bare 401) is not enabled.
  // Match "Bearer" as a challenge SCHEME: at the start or after a comma, and
  // followed by space/comma/end — so NotBearer and the param `Bearer=...`
  // don't count. Strip quoted params first, so a comma inside
  // realm="login, Bearer required" can't look like a separator.
  const wwwAuth = (headers.get("www-authenticate") || "").replace(/"(?:[^"\\]|\\.)*"/g, "");
  const oauthChallenge = /(?:^|,)\s*bearer(?=\s|,|$)/i.test(wwwAuth);

  if (oauthChallenge || /^2/.test(status)) {
    // exit 0 = server ENABLED. Deliberately NOT "green" — that only means the
    // server is on, not that the user is signed in (the caller checks that).
    emit({ check: "jfrog-mcp-responding", status: "enabled", detail: `JFrog MCP server enabled at ${endpoint} (HTTP ${status})` });
    return 0;
  }
  if (status === HTTP_NOT_FOUND || status === HTTP_FORBIDDEN) {
    emit({ check: "jfrog-mcp-responding", status: "not_enabled", detail: `JFrog MCP server not enabled at ${endpoint} (HTTP ${status}) — ask your JFrog platform administrator to enable it (see ${DOCS_URL}).` });
    return 4;
  }
  emit({ check: "jfrog-mcp-responding", status: "unreachable", detail: `could not confirm the JFrog MCP server at ${endpoint} (HTTP ${status})` });
  return 1;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await detectJfrogMcpResponding(process.argv[2]);
}
