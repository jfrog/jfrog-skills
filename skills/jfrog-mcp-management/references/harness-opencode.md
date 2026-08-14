# Harness: OpenCode

OpenCode-specific config for the `jfrog-mcp-management` skill. Read this together
with [harness-common.md](harness-common.md) (shared entry shape and success
criterion). You reached this file because the harness is OpenCode (`OPENCODE`,
set in the environment at startup). This targets all OpenCode surfaces (TUI, CLI,
Desktop, IDE, web) - they share one backend and the same `opencode.json`.

> **How OpenCode stores the entry:** config is **JSON / JSONC** under the
> top-level **`mcp`** key; each server is a **`type: "local"`** entry whose
> **`command` is a single ARRAY** (executable + args combined - there is NO
> separate `args`); env vars go in an **`environment`** object; and value
> references use **`{env:VAR}`** (or `{file:/path}`). Write the entry using the
> JSON template in **Full entry shape** below.

## Config files

- **Default scope: user-level (global).** `~/.config/opencode/opencode.json`
  (`.jsonc` also works) - personal, not committed, applies to every project.
  Create if missing: `{ "mcp": {} }`. (`$OPENCODE_CONFIG`, if set, adds a custom
  config file - merged after the global file and before project config - it does
  NOT replace the global file; `$OPENCODE_CONFIG_DIR`, if set, adds a custom
  config directory whose `opencode.json` / `.jsonc` is also loaded.)
- **Project:** `opencode.json` (or `.jsonc`) in the project root - shareable via
  git. Use ONLY if the user says "for this project" / "commit" / "share with the
  team".
- **Write to exactly one scope, never both.** Config files are merged; project
  overrides global on conflicts. Do not ask which scope unless the user brings it
  up.

## Top-level key

`mcp` - one entry per server: `mcp.<server-name>`. Use `spec.packageName`
directly as the key; special characters (`.` `/` `@`) are fine because OpenCode
sanitizes the name (`[^a-zA-Z0-9_-]` → `_`) when it exposes tools as
`<sanitized-name>_<tool>`.

## Value reference (env / secrets)

`{env:VAR_NAME}` inside the `environment` object, substituted from OpenCode's
environment when it loads `opencode.json` (use `{file:/path}` to read a value
from a file instead). For `Bearer` headers: `"Bearer {env:TOKEN}"`. The user must
export the variable in the shell that launched OpenCode (see
[persisting-env-vars.md](persisting-env-vars.md)); values are picked up on next
launch. **Names are case-sensitive** - each `environment` key that carries a
catalog input MUST equal that input's `name` (from `--inspect`)
character-for-character, or the Agent Guard drops it and the MCP starts with the
value missing. Never write a raw secret - always a `{env:...}` / `{file:...}`
reference.

Full entry shape (`command` is one array; `_JF_ARGS` is a literal in
`environment`; secrets/refs use `{env:...}`):

```json
{
  "mcp": {
    "<spec.packageName>": {
      "type": "local",
      "command": ["npx", "--yes", "--registry", "<REGISTRY_URL>", "@jfrog/agent-guard", "--server", "<SERVER_ID>"],
      "enabled": true,
      "environment": {
        "_JF_ARGS": "project=<JFROG_PROJECT_KEY>&mcp=<spec.packageName>",
        "<SECRET_ENV_OR_HEADER_NAME>": "{env:<SECRET_ENV_OR_HEADER_NAME>}"
      }
    }
  }
}
```

- `"type": "local"` always - never `"remote"` or a top-level `"url"` (those
  bypass the Agent Guard).
- `command` merges the common entry's `command` + `args` into ONE array, same
  tokens in the same order; `--yes` and `--registry <URL>` MUST precede
  `@jfrog/agent-guard`.
- **Include `--server <SERVER_ID>`** to authenticate JFrog - it is the default,
  and required when the user has multiple `jf` servers; it also keeps the entry
  working if the user later adds more servers. (It can be omitted only when a
  single `jf` server is configured, which the Agent Guard auto-resolves; see JFrog
  credentials below.) The `environment` block is only for the upstream MCP's own
  secrets/inputs, never for JFrog credentials.
- **Always keep `environment` with `_JF_ARGS`** - it carries the project +
  package identity the Agent Guard needs to route the request. Omit only optional
  input keys; never drop `_JF_ARGS` or the whole `environment` object.

## JFrog credentials - from the `jf` config

**Include `--server <SERVER_ID>` by default.** It reads that server's URL + token
from the on-disk `jf` CLI config, is unambiguous, and keeps working if the user
later adds more servers. Resolve `<SERVER_ID>` per the agent-guard-common
Pre-flight rules; never emit an empty `--server`.

`--server` can be **omitted only when exactly one `jf` server is configured** - in
that case the Agent Guard auto-resolves it. With **multiple** `jf` servers,
omitting `--server` fails: the Agent Guard cannot choose between them and does NOT
fall back to the `jf` default, so `--server` is required. (When in doubt, include
it.)

**OpenCode exception to the shared rule.** [SKILL.md](../SKILL.md) treats `--server`
as conditional and permits dropping it on the `JFROG_URL`+token env path (see its
Step 4 Guardrails, "`--server` … drop it only on the `JFROG_URL`+token env
path"). **That env path does NOT apply on OpenCode** - do NOT authenticate JFrog via env-var credentials, even though OpenCode would forward `JFROG_URL` / `JFROG_ACCESS_TOKEN` to the server. Use
`--server <SERVER_ID>` (or a single configured `jf` server) as described above. If
there is no usable `jf` server, ask the user to add one (`jf c add <ID>`, or
`jf login`) before continuing.

If credentials cannot be resolved (no `--server` and either zero or multiple `jf`
servers), the entry fails to start and the server connects with no tools.

## Enable

Servers are enabled by default (`enabled: true` is implicit; only
`enabled: false` disables) - writing the entry is enough, there is no separate
approval file. To disable without deleting, set `enabled: false` in the entry and
edit the config file directly.

## Restart

OpenCode reads config and connects MCP servers at startup and does not hot-reload
edits - **tell the user to start a new OpenCode session** (exit and relaunch
`opencode`) so the added/removed entry and any newly exported `environment`
values take effect.

## List installed

`opencode mcp list` (alias `ls`) shows the configured servers with their
connection status. For JFrog metadata, read the `mcp` object from every config
scope listed under **Config files** above (global, `$OPENCODE_CONFIG`,
`$OPENCODE_CONFIG_DIR`, and project). Identify the package by the `mcp=` value in
each entry's
`environment._JF_ARGS`; the entry key is the display name. Parse only the `mcp`
section - do NOT print, log, or return the whole file or unrelated config values
(it may hold provider keys and personal settings).

## Verify

Confirm the server exposes the upstream MCP's **real tools** (they appear to the
agent as `<sanitized-server-name>_<tool>`). `opencode mcp list` shows connection
status, but a "connected" row is NOT proof - the Agent Guard proxy can report up
with 0 upstream tools.

- **An `enable_<slug>_tools` tool is a normal Agent Guard gate**, not an error:
  for MCPs that need sign-in or explicit enablement, the Agent Guard first
  exposes this single tool; invoking it (e.g. "sign in to `<MCP>`") runs the flow
  and the upstream MCP's real tools then appear. Re-check afterward. (OpenCode's
  own `opencode mcp auth` is for `type: "remote"` OAuth servers only and does NOT
  apply to this local Agent Guard entry.)
- If the **real tools never appear** (even after enabling / signing in), a
  required input likely did not reach the server - most often an `environment`
  name or shell export whose case does not match the catalog input `name` (see
  Value reference), or a variable that was not exported in the launching shell.
  Fix it and start a new session. A truly empty tool list = Failed → see the
  "0 tools" troubleshooting in
  [key-rules-and-troubleshooting.md](key-rules-and-troubleshooting.md).

## Remove

Find the target entry by matching `mcp=<spec.packageName>` in
`environment._JF_ARGS`, then delete the `mcp.<server-name>` entry from whichever
config holds it - check every scope listed under **Config files** above (global,
`$OPENCODE_CONFIG`, `$OPENCODE_CONFIG_DIR`, and project). Hand-edit the file
directly (current builds have no `opencode mcp remove`),
touching only the target `mcp.<server-name>` entry and leaving other config
values untouched and unprinted. There is no separate `inputs`-style array to
clean up. Then start a new OpenCode session so the removed server stops loading.
