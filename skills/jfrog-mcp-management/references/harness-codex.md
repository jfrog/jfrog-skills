# Harness: OpenAI Codex

Codex-specific config for the `jfrog-mcp-management` skill. Read this together
with [harness-common.md](harness-common.md) (shared entry shape and success
criterion). You reached this file because the harness is Codex (`CODEX_SANDBOX`
/ `CODEX_THREAD_ID` / `CODEX_CI`). This targets the Codex CLI / IDE extension,
which all share the same `config.toml`.

> **Codex differs from the JSON harnesses:** the config is **TOML** - one
> `[mcp_servers.<name>]` table per server, with the server **`<name>` matching
> `^[a-zA-Z0-9_-]+$`** (derive a slug from `spec.packageName`, see Top-level
> key). Transport is implicit - a `command` key means stdio (omit `type`). The
> default scope is **user-level** (project scope loads only from a *trusted*
> directory). Secrets and env references use an **`env_vars` allow-list** that
> forwards named variables from the launching shell. Write the entry using the
> TOML template in **Full entry shape** below.

## Config files

- **Default scope: user-level.** `~/.codex/config.toml` (or
  `$CODEX_HOME/config.toml` if `CODEX_HOME` is set; on Windows `~` is
  `%USERPROFILE%`, i.e. `%USERPROFILE%\.codex\config.toml`) - personal, not committed,
  applies to every project. Create if missing. Servers live under the
  `[mcp_servers.<name>]` table (top-level key `mcp_servers`).
- **Project:** `.codex/config.toml` in the project root - shareable via git, but
  Codex loads it ONLY when the project is **trusted** (accepted the trust prompt,
  or `projects."<abs-path>".trust_level = "trusted"` in `~/.codex/config.toml`).
  Use ONLY if the user says "for this project" / "commit" / "share with the
  team", and tell them it takes effect only once the directory is trusted.
- **Write to exactly one scope, never both.** User config wins where the two
  overlap. Do not ask which scope unless the user brings it up.

## Top-level key

Use `mcp_servers` - one TOML table per server: `[mcp_servers.<server-name>]`.

**The `<server-name>` MUST match `^[a-zA-Z0-9_-]+$`.** Codex rejects any other
name at startup ("Invalid MCP server name"), so when `spec.packageName` contains
characters like `.` `/` `@`, derive a **slug** for the table key: lowercase
`spec.packageName`, replace each run of characters outside `[a-z0-9_-]` with a
single `-`, and trim leading/trailing `-`. Examples:

1. `org.example/tool` → `org-example-tool`
2. `@scope/pkg` → `scope-pkg`

**Before writing, check for an existing `[mcp_servers.<slug>]` table with that
key.** Re-declaring a TOML key silently overwrites the earlier table (or errors on
strict parsers), and an unrelated server (another Agent Guard package, or a plain
MCP entry with no `_JF_ARGS` at all) may already own that key. Treat the key as
**yours only if its `_JF_ARGS` has `mcp=<spec.packageName>` matching exactly** -
then you are updating that entry. Otherwise, the key is occupied: append a numeric
suffix (`-2`, then `-3`, …) and keep probing until you find a free key (or one
that is already your exact package).

The slug is only a local label - **the authoritative package identity stays in
`_JF_ARGS` (`mcp=<spec.packageName>`)**, which is what the List and Remove flows
match on. Keep `mcp=` set to the exact catalog `spec.packageName`, never the slug.

## Value reference (env / secrets)

In Codex, values come from two `env` mechanisms:

- **`env` table** - inline literal values only. Use it for the non-secret
  `_JF_ARGS` string, and for any non-secret you choose to write literally.
- **`env_vars` array** - an allow-list of variable NAMES that Codex forwards
  from the shell that launched it into the server process. Use this for every
  value that must stay OUT of the file: **all secrets**, and any non-secret you
  prefer to keep as a reference. The user exports the variable in the launching
  shell (see [persisting-env-vars.md](persisting-env-vars.md)); Codex forwards it
  on next launch. If a required forwarded variable is unset, the Agent Guard
  fails at startup - confirm the export before restart. **Never write a raw
  secret into `env`.**

**Names are case-sensitive - copy the catalog input's `name` verbatim.** Every
`env_vars` entry, and every `env` key that carries a **catalog input** value,
MUST equal that input's `name` (from `--inspect`) character-for-character,
including case. (This does NOT apply to `_JF_ARGS` - it is a fixed Agent Guard
key, not a catalog input.) The Agent Guard matches the forwarded variable to the
upstream env var / header name exactly, so an uppercased or renamed variable is
silently dropped and the MCP starts with the value missing. e.g. mcp header input
is named `Authorization` → use `Authorization` (NOT `AUTHORIZATION`) in `env_vars`
and in the user's `export`.

For a `Bearer` header the catalog exposes as a header input, forward it the same
way: have the user export the FULL header value under that exact name - e.g.
`export Authorization="Bearer <token>"` - and list `Authorization` (verbatim
case) in `env_vars`. The prefix and secret both stay out of the file.

Full entry shape - write the whole server as a **single `[mcp_servers.<slug>]`
table** with an inline `env = { … }` (do NOT split `env` into a separate
`[mcp_servers.<slug>.env]` sub-table). `_JF_ARGS` is a literal in `env`;
secrets/refs go through `env_vars`:

```toml
[mcp_servers.<server-name-slug>]
command = "npx"
args = ["--yes", "--registry", "<REGISTRY_URL>", "@jfrog/agent-guard", "--server", "<SERVER_ID>"]
env = { _JF_ARGS = "project=<JFROG_PROJECT_KEY>&mcp=<spec.packageName>", "<NON_SECRET_LITERAL_NAME>" = "<literal value>" }
env_vars = ["<SECRET_OR_REFERENCED_ENV_NAME>"]
```

- `<server-name-slug>` is the sanitized slug from **Top-level key** (matches
  `^[a-zA-Z0-9_-]+$`, needs no quoting); `mcp=` in `_JF_ARGS` keeps the exact
  `spec.packageName`.
- **Include `--server <SERVER_ID>`** to authenticate JFrog on Codex - it is the
  default, and required when the user has multiple `jf` servers. It also keeps the
  entry working if the user later adds more servers. (It can be omitted only when a
  single `jf` server is configured, which the Agent Guard auto-resolves; see JFrog
  credentials below.) `env_vars` here is only for the upstream MCP's own
  secrets/inputs, never for JFrog credentials.
- Omit `env_vars` if there are no forwarded values; omit the extra `env` key if
  `_JF_ARGS` is the only literal. Never emit an empty `--server`.
- **Always write the entry as one section** with the inline `env = { … }` above -
  hand-write it, do NOT run `codex mcp add`. That command splits `env` into a
  separate `[mcp_servers.<slug>.env]` sub-table and cannot express `env_vars`.

## JFrog credentials - from the `jf` config

Codex does NOT forward ambient shell variables, so the Agent Guard reads its JFrog
credentials from the on-disk `jf` CLI config (which the Codex-launched process can
read).

**Include `--server <SERVER_ID>` in `args` by default.** It reads that server's
URL + token from the `jf` config, is unambiguous, and keeps working if the user
later adds more servers. Resolve `<SERVER_ID>` per the agent-guard-common
Pre-flight rules.

`--server` can be **omitted only when exactly one `jf` server is configured** - in
that case the Agent Guard auto-resolves it. With **multiple** `jf` servers,
omitting `--server` fails: the Agent Guard cannot choose between them and does NOT
fall back to the `jf` default, so `--server` is required. (When in doubt, include
it.)

**Codex exception to the shared rule.** [SKILL.md](../SKILL.md) treats `--server`
as conditional and permits dropping it on the `JFROG_URL`+token env path (see its
Step 4 Guardrails, "`--server` … drop it only on the `JFROG_URL`+token env
path"). **That env path does NOT apply on Codex** - Codex does not forward ambient
shell env to the server, so `JFROG_URL` / `JFROG_ACCESS_TOKEN` never reach the
Agent Guard. On Codex, therefore, do NOT authenticate JFrog via env-var
credentials; use `--server <SERVER_ID>` (or a single configured `jf` server) as
described above. If there is no usable `jf` server, ask the user to add one
(`jf c add <ID>`, or `jf login`) before continuing.

If credentials cannot be resolved (no `--server` and either zero or multiple `jf`
servers), the entry fails to start with `connection closed: initialize response`.

## Step 0 activation check under Codex's sandbox

Codex runs shell commands in a sandbox with **no outbound network by default**,
and the skill's Step 0 check (`scripts/jfrog-agent-guard-check.mjs`) probes the
JFrog settings endpoint over the network. So the first run can report `Disabled:
settings endpoint unreachable (fetch failed)` even when the `jf` credentials are
valid - that is the sandbox blocking the request, NOT a missing or unreachable
server. On Codex, treat a first-run `unreachable (fetch failed)` as
**inconclusive, not a Disabled result** - do NOT apply the Step 0 "silently
abort" handling from
[agent-guard-activation.md](agent-guard-activation.md) yet. First re-run the SAME
check with network access (approve the escalated command, or run it outside the
sandbox); only treat the platform as unreachable if it STILL fails with network.
A follow-up `Enabled: via JF CLI config (server '<id>')` confirms it was only the
sandbox. Credentials resolve from the on-disk `jf` config regardless - only the
reachability probe needs network.

## Enable

Codex servers are enabled by default (`enabled = true` is implicit) - there is no
per-server approval file to pre-write. Just make sure the entry is NOT
`enabled = false`. For a **project-scoped** entry, the directory must be trusted
or Codex ignores `.codex/config.toml` entirely. **Trust is the user's decision -
do NOT write `trust_level` yourself to self-approve a directory.** Ask the user to
accept Codex's trust prompt (or, only if they explicitly ask, they can set
`projects."<abs-path>".trust_level = "trusted"` in `~/.codex/config.toml`).

## Restart

Codex reads `config.toml` at startup and does not hot-reload it, and the agent
cannot restart Codex itself - **tell the user to start a new Codex session** (exit
and relaunch `codex`, or open a new session in the IDE extension) so the
added/removed entry and any newly exported `env_vars` take effect.

## List installed

`codex mcp list` for the configured servers with their auth status (one row per
server); `codex mcp get <server-name-slug>` prints one server's resolved config.
For JFrog metadata, read the `[mcp_servers.*]` tables from `~/.codex/config.toml`
(user) and, if trusted, the project `.codex/config.toml`. Identify the package by
the `mcp=` value in each entry's `_JF_ARGS` (the table key is only a slug), and
show it as the display name. When reading an entry for metadata, use ONLY the
table key/slug, the `_JF_ARGS` values (`mcp=` / `project=`), and the `env_vars`
**names** - do NOT read, log, or display the `env` table's values (a user may have
placed a secret there despite the guidance above). An entry that does not appear
in `codex mcp list` is usually a TOML syntax error, an invalid server name (must
match `^[a-zA-Z0-9_-]+$`), or an untrusted project config.

## Verify

Run `/mcp` in the Codex TUI (or check the IDE extension's MCP view) and confirm
the server exposes the upstream MCP's **real tools**. `codex mcp list` shows the
server and its auth status but is NOT proof of working tools - the Agent Guard
proxy can report up with 0 upstream tools.

Codex-specific signals to read correctly:
- **`Auth: Unsupported` is normal** for static-header and local MCPs - it
  describes Codex's own OAuth support, not the upstream MCP. Judge by the tool
  list.
- **An `enable_<slug>_tools` tool is a normal Agent Guard gate**, not an error:
  for MCPs that need sign-in or explicit enablement, the Agent Guard first
  exposes this single tool; invoking it (e.g. "sign in to `<MCP>`") runs the flow
  and the upstream MCP's real tools then appear. Re-check `/mcp` afterward.
- If the **real tools never appear** (even after enabling / signing in), a
  required input likely did not reach the server - most often an `env_vars` name
  or shell export whose case does not match the catalog input `name` (see Value
  reference), or a variable that was not exported in the launching shell. Fix it
  and start a new session. A truly empty tool list = Failed → see the "0 tools"
  troubleshooting in
  [key-rules-and-troubleshooting.md](key-rules-and-troubleshooting.md).

## Remove

Find the target entry by matching `mcp=<spec.packageName>` in `_JF_ARGS`, then
`codex mcp remove <server-name-slug>` (using that entry's table key), or delete
the whole `[mcp_servers.<server-name-slug>]` table by hand. Check BOTH scopes
(user `~/.codex/config.toml` and, if present, project `.codex/config.toml`) per
the SKILL.md Remove flow. There is no top-level `inputs`-style array to clean up.
Then start a new Codex session so the removed server stops loading.
