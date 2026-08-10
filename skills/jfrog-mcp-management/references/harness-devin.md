# Harness: Devin **Desktop**

Devin Desktop-specific config for the `jfrog-mcp-management` skill. Read this
together with [harness-common.md](harness-common.md) (shared entry shape and
success criterion). You reached this file because Step A matched **Devin**:
your system prompt / system instructions identify you as Devin. You may
optionally confirm with `VSCODE_IPC_HOOK` under the Devin user-data dir (e.g.
`~/Library/Application Support/Devin/<version>-main.sock`). The environment
script does not detect Devin.

Devin Desktop is a VS Code-family Electron shell that runs the Cascade / Devin
Local agent. It stores MCP configuration in the Windsurf config file used by
the underlying platform.

## Config files

- **Default scope: user-level.** Personal, not committed, available across all
  workspaces. **Prefer Windsurf** — the same file Cascade uses and that the
  JFrog Desktop extension writes the `jfrog` MCP into:
  - macOS/Linux: `~/.codeium/windsurf/mcp_config.json`
  - Windows: `%APPDATA%\.codeium\windsurf\mcp_config.json`

  Create the parent directory first (`mkdir -p` / platform equivalent), then
  create the file if missing: `{ "mcpServers": {} }`. Devin Local imports this
  file when `read_config_from.windsurf` is not `false` in
  `~/.config/devin/config.json` (default) — so one write serves Cascade and Local.
- **Exception — migrated native store:** If `~/.config/devin/mcp_config.json`
  **already exists** (user accepted **Migrate MCP config** / Copy), Devin Local
  uses that file instead of Windsurf import. For Local, merge entries **there**
  and do **not** require `read_config_from.windsurf`. Cascade never reads the
  native file — if the entry must also appear in Cascade, merge into Windsurf
  as well. Prefer **Cancel** on migrate so both agents stay on Windsurf.
- **Project scope:** Not supported by Devin Desktop's Cascade / Windsurf config.
- Do not ask which scope unless the user brings it up.

## Top-level key

`mcpServers`

## Value reference (env / secrets)

`${env:VAR_NAME}`, resolved from the environment that launched Devin Desktop.
For `Bearer` headers: `"Bearer ${env:TOKEN}"`. Devin Desktop also supports
`${file:~/path/to/file}` to inline a file's trimmed contents. The user must
export the variable in the environment that launches Devin Desktop (see
[persisting-env-vars.md](persisting-env-vars.md)); values are picked up on
next launch. If a required `${env:VAR}` is unset the Agent Guard fails at
startup — confirm the export before restart. Never write a raw secret.

## Enable

Devin Desktop loads every non-disabled entry in `mcpServers` automatically on
window load; there is no per-server approval prompt to pre-approve. If the
entry carries `"disabled": true`, remove it so the server runs. Otherwise
nothing to do here.

## Restart

`Developer: Reload Window` (or fully quit and reopen Devin Desktop). Devin
Desktop re-reads `mcp_config.json` on window load and reconnects each server.

## List installed

Open the **MCP servers** panel (Cascade panel toolbar, or
`Devin Settings → Cascade → MCP Servers`), or **Open customizations** on a
Devin Local session — each configured server is listed with its live
connection state. Servers and their tools are also reachable via `@` in the
chat input. Do **not** use `/mcp` here: that slash command is Devin CLI only;
in Desktop `/` lists workflows, so `/mcp` can fuzzy-match a skill and mislead.
Confirm via the MCP servers panel / Open customizations, or by checking that
`<name>` exists under `mcpServers` in the active store (Windsurf by default;
native `~/.config/devin/mcp_config.json` only when that file already exists —
see Config files). When reading the file, do not report secret values — env
**key names** only; never display resolved `${env:…}` or `${file:…}` contents.

## Verify

Before treating a missing server as Failed: confirm the entry is in the active
store (Windsurf by default; native only when that file already exists). For
Devin Local on Windsurf, also confirm `read_config_from.windsurf` is not
`false`. Skip that flag check when Local is on the native file.

Ask which MCP servers are available, or open the MCP servers panel / Open
customizations, and confirm `<name>` is listed and connected. Then ask the
agent to list that server's tools (or reach it via `@`); the server MUST
expose **at least one tool**. A connected indicator alone is NOT proof — the
Agent Guard proxy can report connected with 0 upstream tools. Empty tool
list = Failed → see the "0 tools" troubleshooting in
[key-rules-and-troubleshooting.md](key-rules-and-troubleshooting.md).

On first connect without cached OAuth, Devin opens a browser to sign in; later
runs reuse stored credentials. Treat **Output → MCP** as authentication /
connection status only — never as a source of token values. Devin Local may
also prompt to approve each MCP tool call by default — grant the prompt before
treating an empty list as a failure.

## Notes

- Cascade always reads `~/.codeium/windsurf/mcp_config.json`. Devin Local
  imports that same file when `read_config_from.windsurf` is enabled in
  `~/.config/devin/config.json` (default). If Local is on Windsurf and that
  flag is `false`, Local will not see Windsurf entries even though the file on
  disk is unchanged.
- Some Devin Desktop builds prompt to copy Windsurf MCP config to
  `~/.config/devin/mcp_config.json` (**Migrate MCP config**). Prefer **Cancel**
  unless the user wants to migrate: once the native file exists, Local uses it
  as its store (no Windsurf-import requirement) while Cascade continues to use
  Windsurf only — installs then diverge unless you write both.
- OAuth `--login` caches tokens in `~/.jfrog/jfrogmcp.conf.json` (same as all
  harnesses); removal cleanup of that file is the same everywhere.
- Devin Desktop is distinct from **Devin CLI** (the `devin` terminal agent):
  the CLI has its own config at `.devin/config.json` / `.devin/config.local.json`
  and is not covered by this harness file. CLI-only surfaces such as `/mcp`
  do not apply here.
