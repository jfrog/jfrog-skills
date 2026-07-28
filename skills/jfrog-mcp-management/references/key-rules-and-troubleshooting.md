# Key rules & troubleshooting

Reference for the Install and List flows of the `jfrog-mcp-management` skill.

## Key Rules

- **Package scope is case-sensitive — ALWAYS write it lowercase as
  `@jfrog/agent-guard`, NEVER `@JFrog/agent-guard`.** npm scopes are
  case-sensitive; the published package is the lowercase `@jfrog/agent-guard`.
  Capitalizing the brand (`@JFrog`) points at a different/nonexistent scope and
  breaks the command. Use the exact lowercase string in every command and config
  entry.
- **`npx` arg order:** `--yes`, `--registry <URL>`, `@jfrog/agent-guard`, then
  agent guard flags. Both `--yes` and `--registry` MUST precede the package
  name or `npx` falls back to the default registry (404) and may block on a
  no-TTY prompt.
- **Always `"type": "stdio"`** pointing at `npx @jfrog/agent-guard`, even for
  remote-only catalog MCPs (the agent guard proxies them). `"http"`, `"sse"`,
  or a top-level `"url"` bypass the agent guard.
- `_JF_ARGS` is **only** for the config entry the agent launches at session
  start (the `env` of the entry written when adding an MCP); MUST contain
  `project=<JFROG_PROJECT_KEY>&mcp=<PACKAGE_NAME>`. NEVER pass `_JF_ARGS` to
  `--list-available`, `--inspect`, or `--login` — those take `--server` /
  `--project` as CLI flags only.
- NEVER assume `default` as a JFrog project key. If the project key is unknown
  after the project chain (existing `mcpServers` entries → `JF_PROJECT` env
  var), STOP and ask the user. Same for server ID if used. NEVER invent or
  guess JFrog project keys or server IDs.
- Package name MUST come from the catalog (`--inspect` / `--list-available`).
  NEVER guess. NEVER install MCPs outside the agent guard. NEVER use
  Fetch/WebFetch for catalog calls.
- NEVER pipe a catalog command through `python3`, and NEVER capture it with
  `2>&1` — `npx`/`npm` writes progress to stderr, which corrupts the output
  stream. For `--list-available` present the compact TSV it prints; for
  `--inspect` read the JSON it prints on stdout directly (or with a single `jq`
  filter), never via `python3`.
- NEVER write a raw secret into any MCP config file (see
  [harness-common.md](harness-common.md) for each harness's file) — always use
  `${VAR_NAME}`. NEVER show tokens / API keys.
- NEVER try multiple servers — ask the user to pick one.

## Troubleshooting

Items below are harness-agnostic unless they point into the current harness's
row in [harness-common.md](harness-common.md).

- **"connected" but 0 tools** (empty tool/capability list in the harness's
  verify view — e.g. Claude Code's `/mcp` `Capabilities:`) — agent guard proxy
  started, upstream MCP did not. A "connected" label is misleading here. NEVER
  report success when there are 0 tools.
  1. Relaunch in the harness's debug mode if it has one (e.g. Claude Code:
     `claude --debug`) and read the agent guard stderr; diagnose by MCP type:
     - **OAuth (remote)** — re-run the OAuth login (`--login`); refresh token
       likely expired.
     - **Static-token (remote)** — confirm every `${VAR}` in `env` is exported
       in the launching shell and the token is still valid.
     - **Local (stdio)** — check that the bundled binary actually launched
       (agent guard stderr will show the spawn error).
  2. Verify that the MCP server is still allowed. See the skill's "Available to
     install" flow.
- **Configured server missing from the harness's list/verify view** —
  rejected/pending. Re-run the enable/verify step (Install → Step 4a).
- **MCP still appears as approved (or won't go away) after editing the config**
  — on harnesses that pre-approve via files (e.g. Claude Code), approval state
  lives in plain JSON arrays read at session start (nothing cached, so `npm
  cache clean` is unrelated). Check that harness's approval-precedence list in
  [harness-common.md](harness-common.md) and remove the entry from every file
  that lists it, then restart. On UI-toggle harnesses (Cursor, VS Code) there is
  no such file — disable/stop the server in the harness's MCP view instead.
- **Agent Guard: `multiple/no JFrog server configured`** (the agent guard
  cannot pick a JFrog server) — pass `--server <ID>` (after `jf c add <ID>`) OR
  export both `JFROG_URL` and `JFROG_ACCESS_TOKEN` in the launching shell, then
  restart the agent.
- **OAuth MCP failing** — refresh token expired; re-run the OAuth login step.
- **401/403 with `${VAR}`** — env var unset/wrong; re-export in the launching
  shell and restart the agent.
- **Network / proxy / DNS error** — outside the agent guard's scope; tell the
  user and stop.
- **npx package fetch returns 403** — usually a corporate proxy/VPN, a blocked
  or wrong registry, or a curation policy. Confirm `--registry
  <REGISTRY_URL>` resolves and the access token is valid for that repo.
