# Harness: Junie

Junie-specific config for the `jfrog-mcp-management` skill (JetBrains IDE panel
and the Junie CLI). Read this together with [harness-common.md](harness-common.md)
(shared entry shape and success criterion). You reached this file because Step A
matched **Junie**: your system prompt / system instructions identify you as
Junie. Config is the same on both surfaces.

> **Junie doesn't interpolate `${VAR}` / `${input:…}`** and has no first-start
> prompt, so secrets come from the inherited process environment, not references
> — keep the command canonical (`npx … @jfrog/agent-guard`), never a `/bin/sh`
> wrapper. `node`, `npx`, and `jf` must be on Junie's `PATH`; if any is "command
> not found" (mainly macOS), the user adds them and restarts — see the JFrog
> JetBrains plugin README → **Troubleshooting**.

## Config files

- **Default scope: user-level.** `~/.junie/mcp/mcp.json` (Windows:
  `%USERPROFILE%\.junie\mcp\mcp.json`) — personal, applies to every project, read
  by both the IDE panel and the CLI, and where the JFrog plugin writes the
  bundled `jfrog` server. Create if missing: `{ "mcpServers": {} }`.
- **Project:** `.junie/mcp/mcp.json` in the project root — ONLY if the user says
  "for this project" / "commit" / "share" (shareable via git).
- Write to exactly one scope; don't ask which unless the user brings it up.

## Top-level key

`mcpServers`

## Value reference (env / secrets)

Junie doesn't interpolate `${VAR}` / `${input:…}`, so any input value comes from
the **process environment** the Agent Guard inherits — it reads each catalog
input/header by its **exact name** (case-sensitive), so the value need not appear
in `mcp.json`.

- **Non-secret** inputs → literals in the `env` map (e.g. `_JF_ARGS`).
- **OAuth** remote MCPs → no static secret; run `--login` (SKILL.md Step 5).
- **Static secret** (`isSecret=true`) → NEVER a literal or wrapper. The user
  exports it under the input's exact name into Junie's environment (e.g.
  `export Authorization="Bearer <token>"` before `idea .`, or `launchctl setenv`
  for a GUI launch) and restarts. You never see or type the value.

> If the tool list stays empty after a static-secret export, Junie isn't
> forwarding that variable on this platform — see the "0 tools" entry in
> [key-rules-and-troubleshooting.md](key-rules-and-troubleshooting.md).

## JFrog credentials — from the `jf` config

Junie may not forward ambient shell env to the MCP subprocess, so authenticate
JFrog via the on-disk `jf` config: **always include `--server <SERVER_ID>` in
`args`** (resolve `<SERVER_ID>` per [agent-guard-common.md](agent-guard-common.md))
so the Agent Guard reads that server's URL + token from `~/.jfrog/` — do not omit
it even with a single `jf` server. Don't rely on `JFROG_URL` /
`JFROG_ACCESS_TOKEN` here — Junie may not forward them.

## Enable

Junie picks up `mcp.json` automatically. If a newly added server does not appear,
open **Settings → Tools → Junie → MCP Settings** and confirm it is listed/enabled.

## Restart

Reloads on save; if the new server does not surface, start a new Junie task or
restart the IDE.

## List installed

Read `mcpServers` from `~/.junie/mcp/mcp.json` (user) and `.junie/mcp/mcp.json`
(project). For live status, open **Settings → Tools → Junie → MCP Settings** —
each configured server and its discovered tools are listed there. There is **no**
interactive `/mcp` command (typing `/mcp` in chat is plain text). Render an
installed / `--list-available` result back to the user as a numbered table.

## Verify

The only proof is tools appearing under the server in **Settings → Tools → Junie
→ MCP Settings**. A "connected" label with 0 tools = Failed → see the "0 tools"
troubleshooting in [key-rules-and-troubleshooting.md](key-rules-and-troubleshooting.md).

## Notes

- The **JFrog project key is always required** — for catalog calls
  (`--list-available` / `--inspect`, as `--project <JFROG_PROJECT_KEY>`) **and
  install** (the written entry's `_JF_ARGS` carries `project=<JFROG_PROJECT_KEY>`).
  Resolve it per [agent-guard-common.md](agent-guard-common.md) **before the first
  call**, same as every harness. Junie has no native prompt, so ask in plain text
  if it's unresolved, or have the user set `JF_PROJECT` in Junie's environment.
- Installed MCPs are ALWAYS the stdio Agent Guard entry from
  [harness-common.md](harness-common.md) — never a top-level `url` (that bypasses
  the Agent Guard), even though Junie's `mcp.json` accepts `url` servers.
- On remove, if the entry used an exported secret, tell the user they can unset
  it; never echo the value.
