# Harness: Kiro

Kiro-specific config for the `jfrog-mcp-management` skill (Kiro IDE and
`kiro-cli`). Read this together with [harness-common.md](harness-common.md)
(shared entry shape and success criterion). You reached this file because
Step A matched **Kiro**: your system prompt / system instructions identify
you as Kiro (Kiro IDE or `kiro-cli`). The environment script does not detect
Kiro. Config, key, and env syntax are identical on both surfaces — no need to
tell them apart for this workflow.

## Config files

- **Kiro IDE only:** enable MCP support (`chat.mcp.enabled` setting) before
  writing `mcp.json` — `kiro-cli` does not need this setting.
- **Default scope: project.** `.kiro/settings/mcp.json` in the workspace root
  — shareable via git. Create if missing: `{ "mcpServers": {} }`.
- **User (global):** `~/.kiro/settings/mcp.json` (or `$KIRO_HOME/settings/mcp.json`
  if `KIRO_HOME` is set). Use ONLY if the user says "personal only" / "do not
  commit". Not always present — create if missing: `{ "mcpServers": {} }`.
  Kiro merges both automatically at startup, workspace taking precedence on
  conflicts.
- Do not ask which scope unless the user brings it up.

## Top-level key

`mcpServers`

## Value reference (env / secrets)

`${VAR_NAME}`, resolved from the shell that launched Kiro. For `Bearer`
headers: `"Bearer ${TOKEN}"`. The user must export the variable in the
launching shell (see [persisting-env-vars.md](persisting-env-vars.md)); values
are picked up on next launch. Never write a raw secret — always `${VAR}`.

Kiro also gates env var expansion: an unapproved `${VAR_NAME}` triggers a
one-time approval popup (setting **Mcp Approved Env Vars**) before the value
is substituted. If a server starts with the value missing, tell the user to
approve it there.

## Enable

Every entry not marked `"disabled": true` runs automatically — writing the
entry is enough, there is no separate approval step. To disable without
deleting, set `"disabled": true` on that server's entry.

## Restart

Editing `mcp.json` needs no restart — both surfaces hot-reload it on save and
reconnect affected servers automatically. But a **newly exported env var**
needs Kiro relaunched: it only reads the shell environment at launch, so a
var exported after Kiro is already running won't resolve until you relaunch.

## List installed

- **`kiro-cli`:** `kiro-cli mcp list workspace` / `kiro-cli mcp list global` for
  live status per scope (`kiro-cli mcp list` alone lists the merged/default
  view). `kiro-cli mcp status --name <name>` for one server.
- **Kiro IDE:** tell the user to type `/mcp` in the chat for live server +
  tool status — do not invoke it as a tool yourself.
- For JFrog metadata on either surface, read `mcpServers` directly from
  `.kiro/settings/mcp.json` (project) and `~/.kiro/settings/mcp.json` (user,
  or `$KIRO_HOME/settings/mcp.json` if `KIRO_HOME` is set).

## Verify

- **`kiro-cli`:** `kiro-cli mcp status --name <name>` for connection status,
  then confirm real tools via `/mcp` in the same chat session (lists each
  active server's tools).
- **Kiro IDE:** tell the user to type `/mcp` in the chat — it lists each
  active server's tools directly, so they can drill into the target server.
  Do not invoke it as a tool yourself.

A connected/active status alone is NOT proof — the Agent Guard proxy can
report up with 0 upstream tools. Empty tool list = Failed, see the "0 tools"
troubleshooting in
[key-rules-and-troubleshooting.md](key-rules-and-troubleshooting.md).
