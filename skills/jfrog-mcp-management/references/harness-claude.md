# Harness: Claude Code

Claude Code-specific config for the `jfrog-mcp-management` skill. Read this
together with [harness-common.md](harness-common.md) (shared entry shape and
success criterion). You reached this file because the harness is Claude Code
(`CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT`).

## Config files

- **Default scope: project.** `.mcp.json` in the project root — shareable via
  git. Create if missing: `{ "mcpServers": {} }`.
- **User (global):** `~/.claude.json`, top-level `mcpServers`. Use ONLY if the
  user says "personal only" / "do not commit". Do NOT use
  `projects.<path>.mcpServers` — that subkey is per-project runtime state, not a
  registry.
- Do not ask which scope unless the user brings it up.

## Top-level key

`mcpServers`

## Value reference (env / secrets)

Plain `${VAR_NAME}`, resolved from the shell that launched Claude Code. For
`Bearer` headers: `"Bearer ${TOKEN}"`. The user must export the variable in the
launching shell (see [persisting-env-vars.md](persisting-env-vars.md)); values
are picked up on next launch. Never write a raw secret — always `${VAR}`.

## Enable

Pre-approve to skip the per-server prompt: edit
`<cwd>/.claude/settings.local.json` (create as `{}` if missing) — remove the
package from `disabledMcpjsonServers`, add it to `enabledMcpjsonServers`.
Team-wide (committed): write the same arrays to `<cwd>/.claude/settings.json`.
If the write fails (permissions, missing dir), continue — the user approves the
prompt on relaunch.

## Restart

`/exit` or `/reload-plugins` in the same directory. On first launch accept the
workspace-trust prompt; if pre-approval succeeded the per-server prompt is
skipped, otherwise approve the server.

## List installed

`claude mcp list` for live connection status (one row per server). For JFrog
metadata, read `mcpServers` from `.mcp.json` (project) and `~/.claude.json`
(user).

## Verify

`/mcp` → **drill into the server entry** (arrow into it, not just the top-level
row) → read `Capabilities:`. It MUST list at least one tool. Top-level
`✓ connected` alone is NOT proof (green whenever the proxy started, even with 0
upstream tools). Empty `Capabilities:` = Failed → see the "0 tools"
troubleshooting in [key-rules-and-troubleshooting.md](key-rules-and-troubleshooting.md).

## Approval / stuck-state precedence

If a server "still appears approved (or won't go away)", approval state lives in
plain JSON arrays read at session start (nothing cached; `npm cache clean` is
unrelated). Check, in precedence order:

1. `<cwd>/.claude/settings.local.json` — per-user, gitignored (where Enable writes by default)
2. `<cwd>/.claude/settings.json` — team-shared, committed to git
3. `~/.claude/settings.json` — user-global, applies to every repo
4. `~/.claude.json` → `projects["<absolute cwd>"].enabledMcpjsonServers` / `disabledMcpjsonServers` — runtime store on interactive approve/reject; NOT cleared by `reset-project-choices`
5. Managed `managed-settings.json` (`/Library/Application Support/ClaudeCode/` on macOS, `/etc/claude-code/` on Linux, `%ProgramData%\ClaudeCode\` on Windows) — can't be overridden

Also check `enableAllProjectMcpServers: true` in any of (1)–(3) — it
auto-approves every entry. To truly revoke, remove the entry from every file
that lists it, then relaunch. A missing entry from `claude mcp list` is usually
a JSON parse failure (undefined `${VAR}`) or an `allowedMcpServers` /
`deniedMcpServers` policy in `managed-settings.json`.
