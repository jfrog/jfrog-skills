# Harness: Cursor

Cursor-specific config for the `jfrog-mcp-management` skill. Read this together
with [harness-common.md](harness-common.md) (shared entry shape and success
criterion). You reached this file because the harness is Cursor (`CURSOR_AGENT`
/ `CURSOR_CLI` / `CURSOR_TRACE_ID`).

## Config files

- **Default scope: project.** `.cursor/mcp.json` in the project root — shareable
  via git. Create if missing: `{ "mcpServers": {} }`.
- **User (global):** `~/.cursor/mcp.json`. Use ONLY if the user says "personal
  only" / "do not commit".
- Do not ask which scope unless the user brings it up.

## Top-level key

`mcpServers`

## Value reference (env / secrets)

`${env:VAR_NAME}`, resolved from the shell that launched Cursor. For `Bearer`
headers: `"Bearer ${env:TOKEN}"`. The user must export the variable in the
launching shell (see [persisting-env-vars.md](persisting-env-vars.md)); values
are picked up on next launch. If a required `${env:VAR}` is unset the Agent
Guard fails at startup — confirm the export before restart. Never write a raw
secret.

## Enable

Cursor stores enable/approval state separately and does NOT auto-enable new
**workspace-level** servers (user-level installs often auto-enable). ASK the
user to enable the installed MCP via the UI toggle in **Settings → Tools & MCPs**.

## Restart

`Developer: Reload Window`.

## List installed

`cursor agent mcp list` for status (one row per server). For JFrog metadata,
read `mcpServers` from `.cursor/mcp.json` (project) and `~/.cursor/mcp.json`
(user). If a configured entry does not appear in `cursor agent mcp list`, it was
never enabled — re-run Enable.

## Verify

**`cursor agent mcp list` / `cursor agent mcp enable` are NOT authoritative** for
the Cursor IDE — do not treat them as proof the MCP works. The only proof is that
tool descriptor files are actually present at:

```
~/.cursor/projects/<this-workspace>/mcps/<mcp-server-name>/tools/*.json
```

(`<mcp-server-name>` is the JSON key of the MCP, optionally prefixed `user-`.)
NEVER ask the user to inspect these files themselves — after they enable the MCP,
**offer to check the `tools/` directory for them**. If `tools/` is empty or
missing after a `Developer: Reload Window`, treat as Failed → see the "0 tools"
troubleshooting in [key-rules-and-troubleshooting.md](key-rules-and-troubleshooting.md).

## Notes

Cursor has no `enabledMcpjsonServers`-style precedence files — enable/disable is
the UI toggle above. OAuth `--login` in a sandbox must run with `all`
permissions (see [runtime-permissions.md](runtime-permissions.md)).

## Sandbox network allowlist (Agents Window)

**Trigger — do not apply this by default.** Only act on this once you actually
see it: in a Cursor sandbox agent (`CURSOR_SANDBOX=seatbelt`, e.g. the Agents
Window) an Agent Guard call can't reach a JFrog host — the Step 0 activation
check can't reach the platform, and/or an `npx` / catalog call returns a `403`
on a JFrog host. That's Cursor's sandbox network allowlist. A Step 0 network
failure here is inconclusive — don't report the platform as disabled or abort.
The gate uses `jf api` for a configured server and a direct request for
environment-only credentials. After the host is allowlisted, re-run Step 0
and follow its exit code. Do not bypass the gate.

1. **Retry the same command once with `required_permissions: ["full_network"]`**
   (see [runtime-permissions.md](runtime-permissions.md)).
2. **If it 403s again, has no effect, or the param isn't on your Shell tool
   (e.g. the Agents Window), go straight to the allowlist fallback below.** Do
   NOT keep retrying `full_network`, and do NOT offer to run the command outside
   the sandbox or ask the user to run it in their own terminal. Create or edit
   `~/.cursor/sandbox.json` (user) or `.cursor/sandbox.json` (project)
   yourself, adding the blocked host to the existing `allow` array if the file
   already exists (don't overwrite it), then ask the user to reload the window.

Allow whatever host the `403` names; JFrog usually also redirects the binary
download to Amazon S3, so `*.s3.amazonaws.com` is typically needed too. SaaS:

```json
{ "networkPolicy": { "default": "deny", "allow": ["*.jfrog.io", "*.s3.amazonaws.com"] } }
```

Self-hosted (platform on your own domain):

```json
{ "networkPolicy": { "default": "deny", "allow": ["artifactory.example.com", "*.s3.amazonaws.com"] } }
```
