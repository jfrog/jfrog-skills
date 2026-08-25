# Harness: Devin

Devin-specific config for the `jfrog-mcp-management` skill (Devin CLI and
Devin Local in Devin Desktop). Read this together with
[harness-common.md](harness-common.md) (shared entry shape and success
criterion). You reached this file because Step A matched **Devin**: your
system prompt / system instructions identify you as Devin. The environment
script does not detect Devin.

This harness targets the **Devin plugin** path only.

## Detect the Devin surface

Run this from **your** agent environment (not a terminal the user typed into —
the two can differ) before choosing restart or verify steps:

```bash
printf 'TERM_PROGRAM=%s\n' "${TERM_PROGRAM-<unset>}"
printf 'VSCODE_IPC_HOOK=%s\n' "${VSCODE_IPC_HOOK-<unset>}"
```

Classify from the result. **Environment markers win over system-prompt
wording**, because Devin Local's system prompt also describes an "interactive
command line agent" and must NOT be treated as CLI:

- **Devin Desktop (Devin Local):** `VSCODE_IPC_HOOK` is set to a path inside a
  Devin user-data directory (contains `/Devin/` on macOS/Linux, `\Devin\` on
  Windows). Optionally the system prompt identifies Devin Desktop /
  Devin Local.
- **Devin CLI:** no Devin Desktop marker above — `VSCODE_IPC_HOOK` unset (or
  not under a Devin user-data dir). This holds even when the system prompt
  calls you an "interactive command line agent".
- If a Desktop marker is present, choose Desktop even if the prompt reads
  CLI-like. If nothing is conclusive, ASK the user — do not guess.

Use the matching Desktop or CLI instructions below for restart, list, and
verify. **Config write path is the same for both** (see Config files). Do not
mix restart or verification surfaces.

## Config files

Both Devin CLI and Devin Local use the same Devin MCP config files.

- **Default scope: user-level.** Personal, not committed, available across all
  workspaces:
  - macOS/Linux: `~/.config/devin/mcp_config.json`
  - Windows: `%APPDATA%\devin\mcp_config.json`

  Create the parent directory first (`mkdir -p` / platform equivalent), then
  create the file if missing: `{ "mcpServers": {} }`.
- **Project scope** (only if the user asks): `.devin/mcp_config.json` in the
  project root (shared / commit-able).
- **Local project override** (only if the user asks): `.devin/mcp_config.local.json`
  (gitignored; personal keys).
- Do not ask which scope unless the user brings it up; use the user-level
  default above.

## Top-level key

`mcpServers`

## Value reference (env / secrets)

`${env:VAR_NAME}`, resolved from the environment that launches the current
surface (Devin Desktop or Devin CLI). For `Bearer` headers:
`"Bearer ${env:TOKEN}"`. Also supports `${file:~/path/to/file}` to inline a
file's trimmed contents. The user must export the variable in the launching
environment (see [persisting-env-vars.md](persisting-env-vars.md)); values are
picked up on next launch / new session. If a required `${env:VAR}` is unset
the upstream MCP may fail at startup — confirm the export before restart.
Never write a raw secret.

`${env:…}` / `${file:…}` are for the upstream MCP's own secrets and inputs —
never for JFrog Agent Guard credentials (see below).

## JFrog credentials - from the `jf` config

On Devin (CLI and Desktop Local), authenticate Agent Guard only through the
on-disk `jf` CLI config. **Always include `--server <SERVER_ID>`** in every
Agent Guard command and written MCP config entry — resolve `<SERVER_ID>` per
the agent-guard-common Pre-flight rules, never emit an empty `--server`, and do
**not** omit `--server` even when only one `jf` server is configured (explicit
server ID matches plugin enforcement).

Do **not** use the shared [SKILL.md](../SKILL.md) env-var auth path
(`JFROG_URL` / `JFROG_ACCESS_TOKEN`, or legacy `JF_URL` / `JF_ACCESS_TOKEN`) on
Devin, even though Devin would resolve or forward them into Agent Guard. If
there is no usable `jf` server, ask the user to add one (`jf c add <ID>`, or
`jf login`) before continuing.

If credentials cannot be resolved (no `--server <SERVER_ID>` in the entry, or no
usable `jf` server to resolve one from), the entry fails to start and the server
connects with no tools.

## Enable

Both surfaces start every server under `mcpServers` that is not marked
`"disabled": true` on that server's own entry (per-server flag in the config —
same idea as `devin mcp disable` / `enable`). If `<name>` has
`"disabled": true`, remove that flag so the server can run. Approving MCP tool
calls in chat is separate from enablement.

## Restart

- **Devin Desktop (Local):** tell the user to run `Developer: Reload Window` (or fully quit and
  reopen Devin Desktop). Desktop re-reads MCP config on window / session load.
- **Devin CLI:** tell the user to start a new Devin CLI session — exit and run
  `devin` again in the same directory — so the added/removed entry takes
  effect (user, project, and local MCP config files are read at session start).

## List installed

Read `mcpServers` from `~/.config/devin/mcp_config.json` (or the project/local
file if that scope was used). Do not report secret values — env **key names**
only.

- **Devin CLI and Devin Desktop (Local):** run `devin mcp list` for
  live connection status.
- If the config and `devin mcp list` are not enough, tell the user to run
  `/mcp` for the interactive status panel. On **Devin Desktop (Local)** only,
  they can also open **Open customizations** (MCP list) and report each
  server's status.

## Verify

Before treating a missing server as Failed, confirm the entry is in the active
store for this harness (user `~/.config/devin/mcp_config.json` by default).

After the user completes Restart (see Restart), run `devin mcp list` for connection status,
then **list that server's live tools** through the connected MCP (Devin CLI and
Devin Desktop Local).

The server MUST expose **at least one tool**. A connected indicator alone is
NOT proof — the Agent Guard proxy can report connected with 0 upstream tools.
Empty tool list = Failed → see the "0 tools" troubleshooting in
[key-rules-and-troubleshooting.md](key-rules-and-troubleshooting.md).

Do **not** treat a tool list scraped from npm / GitHub docs as verification —
only a live tool list from the connected server counts.

On first connect without cached OAuth, Devin opens a browser to sign in; later
runs reuse stored credentials. Devin Local and Devin CLI may prompt to approve
each MCP tool call by default — grant the prompt before treating an empty list
as a failure.

## Notes

- Devin CLI and Devin Local share the same MCP config paths. An install from
  either surface is visible to the other after the appropriate restart.
- OAuth `--login` caches tokens in `~/.jfrog/jfrogmcp.conf.json` (same as all
  harnesses); removal cleanup of that file is the same everywhere.
