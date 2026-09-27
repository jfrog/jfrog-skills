# Harness: VS Code (GitHub Copilot)

VS Code-specific config for the `jfrog-mcp-management` skill. Read this together
with [harness-common.md](harness-common.md) (shared entry shape and success
criterion). You reached this file because the harness is the VS Code editor
(`TERM_PROGRAM=vscode`, no `CURSOR_*` set). This targets the VS Code **editor**
with Copilot MCP support — not the standalone GitHub Copilot terminal CLI, which
has no `mcp.json` or editor UI and uses the Fallback path instead.

> **VS Code differs from the others in three ways:** the top-level key is
> **`servers`** (not `mcpServers`); the default scope is **user-level** (not
> project); and secrets use a top-level **`inputs` array** with `${input:<id>}`,
> not shell env vars.

## Config files

- **Default scope: user-level.** Personal, not committed, available across all
  workspaces. Open with `MCP: Open User Configuration`; on disk:
  - macOS: `~/Library/Application Support/Code/User/mcp.json`
  - Linux: `~/.config/Code/User/mcp.json`
  - Windows: `%APPDATA%\Code\User\mcp.json`

  Create if missing: `{ "servers": {}, "inputs": [] }`.
- **Workspace:** `.vscode/mcp.json`. Use ONLY if the user says "for this
  project" / "commit" / "share with the team" (shareable via git).
- **Write to exactly one scope, never both.** In the default case write only the
  user-level file; when the user opts into workspace scope write only
  `.vscode/mcp.json` and do NOT touch the user-level config.
- Do not ask which scope unless the user brings it up.

## Top-level key

`servers` (NOT `mcpServers`). Writing `mcpServers` produces a file VS Code
silently ignores.

## Value reference (env / secrets)

A top-level **`inputs` array**, referenced from `env` as `"${input:<id>}"`. VS
Code prompts for each value on first start and stores it (OS keychain) — there
is no shell export, so [persisting-env-vars.md](persisting-env-vars.md) does not
apply here.

Full entry shape (note the sibling `inputs` array alongside `servers`):

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "<mcp-slug>-<secret-input-name>",
      "description": "<description from the catalog>",
      "password": true
    }
  ],
  "servers": {
    "<spec.packageName>": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "--registry", "<REGISTRY_URL>", "@jfrog/agent-guard", "--server", "<SERVER_ID>"],
      "env": {
        "_JF_ARGS": "project=<JFROG_PROJECT_KEY>&mcp=<spec.packageName>",
        "<SECRET_ENV_OR_HEADER_NAME>": "${input:<mcp-slug>-<secret-input-name>}"
      }
    }
  }
}
```

Rules for the `inputs` block:

- One entry per env var / header you configure from Step 3.
- `id`: `<mcp-slug>-<input-name>`, all lowercase, hyphenated; unique within the
  file. Reference from `env` as `"${input:<id>}"`.
- `type`: always `"promptString"`.
- `password: true` for catalog `isSecret=true`. **OMIT the `password` key
  entirely** (never set it to `false`) for non-secrets like URLs/flags.
- `description`: use the catalog `description`; if empty, construct a brief one.
- `Bearer` headers: use `"Bearer ${input:<id>}"` and ask only for the token.

## Enable

Writing the entry is not enough — the server must be started via the UI. If it
is not already running, ask the user to **Start** it: the **Start** CodeLens
above the `mcp.json` entry, or `MCP: List Servers` → select it → **Start
Server**. On first start VS Code prompts for each `${input:...}` value; required
ones must be supplied or the server fails to start.

## Restart

`Developer: Reload Window`, or `MCP: List Servers` → Restart the server.

## List installed

Read `servers` from BOTH the workspace `.vscode/mcp.json` and the user-level
`mcp.json` (paths above). Live status (Running / Stopped / Failed) is UI-only —
the agent cannot read it. Only when the user explicitly asks whether a server is
running, or while troubleshooting, ask them to open `MCP: List Servers` and
report each server's status. An entry that does not appear there was never
started — re-run Enable.

## Verify

If you can already see or call at least one upstream tool from this
server, skip this check. Otherwise: Enable / Restart if that has not
happened, then check this session again. Only then ask the user to open
`MCP: List Servers` and say whether the server is up. Do not ask them
for a tool count.

Success: at least one upstream tool from this server is available to you.
The server being up is not success.

Empty tool list: not success, not a diagnosis — follow
[Connected but 0 tools](key-rules-and-troubleshooting.md#connected-but-0-tools).
Do not invent another debug path until that section is finished.

## Remove cleanup

VS Code is the only harness with a top-level `inputs` array, so removal has an
extra step the harness-agnostic flow does not: after deleting the server's entry
from `servers`, also delete from the top-level `inputs` array every entry whose
`id` was referenced (as `"${input:<id>}"`) ONLY by that server's `env` — i.e.
every `inputs` entry now orphaned. Leave NO orphaned `inputs` entries for the
removed server; a dangling `${input:<id>}` declaration keeps its keychain-stored
value alive after the server is gone. Do NOT delete an `id` still referenced by
another surviving server. If removing the server empties `inputs`, an empty
`inputs: []` (or dropping the key) is fine. Operate by `id` only — never print or
echo any stored value.

## Notes

A wrong stored secret is cleared via the **Clear** CodeLens above the matching
`inputs` entry in `mcp.json`; then restart the server and VS Code re-prompts.
Several steps here (Start, entering inputs) are UI-only **user** actions —
ask the user to do them. Editing `mcp.json`, running the agent guard
commands, and checking this session's tools are your steps. `MCP: List
Servers` only when you cannot see tools yourself, or when they ask whether
a server is running — do not ask them for a tool count.
