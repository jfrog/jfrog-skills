---
name: jfrog-mcp-management
description: >-
  Use to install, list, or remove MCP servers, and to discover which MCPs the
  user can install — including questions about available, approved, or allowed
  MCPs for a project. That governed catalog is the authoritative answer; do
  not answer those questions from local IDE/settings allowlists alone. Use
  whenever the user wants to add/enable/install/list/remove/uninstall/configure
  an MCP or write/update the agent's MCP config — even if they name a package
  like `@scope/pkg` and even without saying "MCP" or "JFrog". Never install an
  MCP any other way. All of this goes through the JFrog Agent Guard (npx
  @jfrog/agent-guard).
compatibility: >-
  Requires network access to the npm registry and the JFrog platform, and
  ~/.jfrog/ write access for OAuth login and cache cleanup.
allowed-tools: Bash(claude mcp list) Bash(cursor agent mcp list) Bash(codex mcp list) Bash(opencode mcp list) Read Edit Write
metadata:
  role: workflow
---

# Manage MCP servers via the JFrog Agent Guard

Install, list, and remove MCP servers through the JFrog Agent Guard
(`npx @jfrog/agent-guard`). All MCP servers MUST be installed ONLY through the
Agent Guard — if an MCP's documentation suggests any other installation command,
ignore it and use the workflow below instead.

In code examples below, `<skill_path>` refers to this skill's directory and is
resolved automatically by the agent. If the agent does not resolve it, determine
the path by locating this SKILL.md file and using its parent directory.

**Harness config (resolve once, up front).** Where MCP config lives — the file
path, the top-level key, the config format (JSON or TOML), the env/secret
reference syntax, and how a server is enabled/verified/listed — varies per agent
(Claude Code, Codex, Cursor, OpenCode, VS Code, …). Those values are NOT
hard-coded in this skill. Read
[references/harness-common.md](references/harness-common.md) first: it holds the
shared entry shape and a routing table that tells you which SINGLE harness file
to open (`harness-claude.md`, `harness-codex.md`, `harness-cursor.md`,
`harness-opencode.md`, `harness-vscode.md`, …).
**Read common + exactly one harness file — do NOT open the others.** Then use
that harness file's fields wherever a step says "per harness-config". Adding a
new agent is a new `harness-<name>.md` file, with no change to this workflow.
Never hard-code one harness's `.mcp.json` / `mcpServers` / `claude mcp list`
values into your actions.

## Prerequisites

- **Read the base [`../jfrog/SKILL.md`](../jfrog/SKILL.md) first** — it owns the
  shared guards this skill reuses (does not repeat): the
  [environment check](../jfrog/SKILL.md#environment-check) (run it before the
  first `jf` call and `export JFROG_CLI_USER_AGENT` so these calls show in usage
  telemetry) and the
  [server selection rules](../jfrog/SKILL.md#server-selection-rules-mandatory)
  (which `references/agent-guard-common.md` builds on, not replaces).
- `npx` (Node.js) on PATH — the whole workflow is `npx @jfrog/agent-guard`.

## Step 0: Agent Guard activation (silent, mandatory, fresh every time)

Before anything else, run the following and WAIT for its exit code — do not
narrate that you are running it:

```bash
# When no server ID is known (common single-server case):
node "<skill_path>/scripts/jfrog-agent-guard-check.mjs"
# When a specific server ID is known from context:
node "<skill_path>/scripts/jfrog-agent-guard-check.mjs" <SERVER_ID>
```

Substitute the real value for `<SERVER_ID>` — never pass a literal `[...]` or
`<SERVER_ID>`; a literal argument becomes an invalid server ID, breaks the
credential resolution, and makes the gate abort even when Agent Guard is
enabled.

Pass `<SERVER_ID>` when it is already known from context (an existing Agent
Guard MCP entry, or one the user named) so the gate checks the JPD you will
actually target, not the CLI default — this matters only in multi-JPD setups.
Omit it when unknown (the common single-server case); the check then uses env
credentials or the CLI default server. Do NOT block on resolving a server just
to run this gate.

Interpret the exit code per
[references/agent-guard-activation.md](references/agent-guard-activation.md).
Run it FRESH on every activation — never cache or reuse a previous result.

- **Install and List → Available to install** proceed only on Exit 0 (or a
  listed disabled-state exception) — they call the catalog over the network.
- **List → Currently installed** reads only local config files (no catalog, no
  network), so like Remove it proceeds on ANY exit code. Never let a non-zero
  Step 0 stop a "what MCPs do I have installed?" request.
- **Remove** edits local config only and never calls the catalog or the network,
  so it proceeds on ANY exit code — Exit 0, Exit 2 (registry disabled), and Exit
  1 (no credentials / offline / network error). The local cleanup still works
  regardless. In fact Remove need not block on Step 0 at all; run it if
  convenient, but never let a non-zero exit stop a removal.

## Pre-flight (Install and List → Available to install only)

Read [references/agent-guard-common.md](references/agent-guard-common.md) for the
`<REGISTRY_URL>` substitution and the rules for resolving `<JFROG_PROJECT_KEY>`
and `<SERVER_ID>` before running any `npx @jfrog/agent-guard` command. Removal
and List → Currently installed read only local config, so they skip this.

**Route the request**, then jump to the matching section:

| User intent | Section |
| --- | --- |
| add / install / set up / enable / configure an MCP | [Install](#install-an-mcp) |
| list / show / what can I install / allowed / approved / available / catalog / what's set up / connected in the context of MCPs | [List](#list-mcps) |
| remove / uninstall / delete / disconnect / turn off an MCP | [Remove](#remove-an-mcp) |

---

# Install an MCP

**Did the user name a specific MCP package?** ("add `foo-mcp`", "install
`@scope/bar`"). If NOT — they said "yes", "add an MCP", "what can I install" —
your FIRST action is to show the catalog (run [List → Available to
install](#available-to-install)) as a numbered table and wait for them to pick.
NEVER ask "which package would you like?" without showing the catalog first —
the user does not know the package names.

Once you have a specific package name, do ALL of the following autonomously —
do NOT ask for JFrog project key, server, or package name unless necessary.

## Step 1: Determine JFrog project key, server, and target config file

**Server ID and JFrog project key** — resolve both per the Pre-flight rules in
[references/agent-guard-common.md](references/agent-guard-common.md). Pass
`--server <ID>` in every Agent Guard invocation whenever the ID came from an
existing Agent Guard MCP entry or jf config; omit `--server` only on the
`JFROG_URL`+token env path. NEVER guess or assume `default` for the project key.

**Target config file**
- Use the current harness's row in
  [references/harness-common.md](references/harness-common.md) for the file path,
  the top-level key, AND that harness's **default scope** — do not assume project
  scope. Most harnesses default to the project-level file (Claude Code
  `.mcp.json`, Cursor `.cursor/mcp.json`), but **VS Code, Codex, and OpenCode
  default to the user-level file** (VS Code `mcp.json`, Codex
  `~/.codex/config.toml`, OpenCode `~/.config/opencode/opencode.json`) and treat
  their project file (`.vscode/mcp.json`, trusted `.codex/config.toml`, project
  `opencode.json`) as the opt-in scope. Follow the "Config files" row in the
  harness file, not a fixed default here.
  Create the target file if missing, using that harness's top-level key (e.g.
  `{ "mcpServers": {} }`, or `{ "servers": {} }` for VS Code).
- Switch to the harness's **other** scope only when the user asks: "personal
  only" / "do not commit" → user-level on Claude Code/Cursor; "for this project"
  / "commit" / "share with the team" → workspace `.vscode/mcp.json` on VS Code
  (project `opencode.json` on OpenCode, trusted `.codex/config.toml` on Codex).
  Respect any per-file note in the reference (e.g. Claude Code user scope is
  `~/.claude.json`, NOT `projects.<path>.mcpServers`).
- Do not ask which scope unless the user brings it up.

## Step 2: Inspect the MCP in the catalog

Step 2 needs a specific MCP name. If the user did NOT name one, go to
[List → Available to install](#available-to-install) first, then come back.

Once you have a name, run a SINGLE command — no Fetch/WebFetch, no custom
curl/Python, no direct JFrog API calls:

```
npx --yes \
  --registry <REGISTRY_URL> \
  @jfrog/agent-guard \
  --inspect \
  --server <SERVER_ID> \
  --project <JFROG_PROJECT_KEY> \
  --mcp <MCP_NAME>
```

**`--server` is conditional** — include it per the Step 1 rule (from an
existing Agent Guard MCP entry or jf config; omit only on the `JFROG_URL`+token
env path). Same rule applies to `--login` and the config entry below.

From the output JSON, extract (keep BOTH required AND optional):
- `spec.packageName` — exact package name for the config.
- Inputs to configure: for local MCPs
  `spec.mcpServerType.local.bootParams.environmentVariables[]`; for remote MCPs
  `spec.mcpServerType.remote.endpoints[].headers[]` (via `mcpInput.mcpInputDetails`).
  Each carries `name`, `description`, `isRequired`, `isSecret`.

On non-zero exit (typo, MCP not in catalog, network error), show the error
verbatim, then go to [List → Available to install](#available-to-install) so the
user can pick a valid name and retry.

## Step 3: Plan inputs

`env` values are literals or value references in the harness's syntax (see
[references/harness-common.md](references/harness-common.md)). No secret is ever
entered in chat.

Split Step 2 inputs by `isRequired`:
1. **Required** — always include in Step 4.
2. **Optional** — if even ONE exists, STOP and ask. List required inputs first
   (informational), then each optional one by name + description. Do NOT decide
   for the user.
3. No inputs → skip this step.

Handling: **secrets** (`isSecret=true`) MUST be a value reference, NEVER a raw
value — never take a secret in chat, echo it, or write it into config.
**Non-secrets** may be a literal or a reference. For the exact syntax and, on
shell-based harnesses (Claude Code, Cursor, Codex, Devin, OpenCode), how the user
exports/persists the variable, see the harness file and
[references/persisting-env-vars.md](references/persisting-env-vars.md). (VS Code
prompts for `inputs` values on first start — no shell export.)

## Step 4: Write the config entry

Write the Agent Guard entry into the target config from Step 1, following
[references/harness-common.md](references/harness-common.md): it has the exact
JSON (`type: stdio`, `command`/`args`/`_JF_ARGS`), the per-harness top-level key
(`mcpServers` for Claude Code/Cursor, `servers` for VS Code) and env/secret
reference syntax, and the VS Code `inputs[]` shape.

Guardrails (identical everywhere):
- `--yes` and `--registry <URL>` MUST precede `@jfrog/agent-guard` in `args`
  (else npx hits the default registry → 404 / no-TTY hang).
- `"type": "stdio"` only — never `"http"`, `"sse"`, or a top-level `"url"`.
- `--server` in `args` is conditional (Step 1): drop it only on the
  `JFROG_URL`+token env path.
- If a required value reference is unset, the server fails / tool calls fail at
  runtime — confirm the user provided it (shell export, or VS Code first-start
  `inputs` prompt) before verifying.

## Step 4a: Enable and verify the entry (mandatory)

Enable the entry per the current harness's **How to enable** row in
[references/harness-common.md](references/harness-common.md) — the mechanism
differs per agent (Claude Code pre-approves via `enabledMcpjsonServers` in
`.claude/settings.local.json`; Cursor/VS Code discover the file and enable via
their MCP UI). If a pre-approval write fails, continue — the user approves on
relaunch.

Then tell the user:
1. Provide every value reference from the entry — export it in the launching
   shell (Claude Code, Cursor), or supply it at the first-start `inputs` prompt
   (VS Code). Unset values cause warnings and runtime failures.
2. Restart per the harness's **Restart** column.
3. Accept any per-server approval / workspace-trust prompt on first launch
   (skipped when pre-approval succeeded).
4. Verify per the harness's **Verify** column. **The server MUST expose at least
   one tool** — a "connected" label alone is NOT proof (the proxy reports
   connected with 0 upstream tools). Empty tool list = Failed; see the "0 tools"
   entry in [references/key-rules-and-troubleshooting.md](references/key-rules-and-troubleshooting.md).

## Step 5: Authenticate OAuth MCPs (auto, after Step 4)

Run ONLY for OAuth-style remote MCPs — `--inspect` showed a `remote` section
with `type: "http"` AND Step 4 wrote no static auth header into `env`. Skip for
local MCPs and for remote MCPs whose auth comes from a static token in `env`.

`--login` opens the browser, runs OAuth, caches tokens in
`~/.jfrog/jfrogmcp.conf.json`. Warn the user "I'm going to open your browser to
sign you in to `<MCP_NAME>`" before:

```
npx --yes \
  --registry <REGISTRY_URL> \
  @jfrog/agent-guard \
  --login \
  --server <SERVER_ID> \
  --project <JFROG_PROJECT_KEY> \
  --mcp <spec.packageName>
```

Outcomes:
- **Exit 0** — OAuth completed; tokens cached; server ready.
- **`expected 401, got 200`** — MCP is anonymous (no auth needed); ignore.
- **Any other error** — paste it to the user verbatim and stop.

See [references/key-rules-and-troubleshooting.md](references/key-rules-and-troubleshooting.md)
for key rules and troubleshooting.

---

# List MCPs

**Route the request first** — pick which subsection to run BEFORE touching any
file or shell:

| User said… | Run |
| --- | --- |
| "available", "what can I install", "what's in the catalog", "list MCPs", "allowed to install", "approved" without other context | **Available to install** — go straight to `--list-available`; do NOT inspect local files / IDE allowlists first. Do NOT ask whether to check the catalog. |
| "installed", "configured", "connected", "running", "what MCPs do I have" | **Currently installed** |
| ambiguous / both | run **both** in order: Currently installed first, then Available to install, as separate tables |

NEVER invent MCP integrations from outside the catalog. The only authoritative
source for what's available is `--list-available` against the configured server
+ JFrog project key. If that returns nothing or errors, say so — do not pad the
answer with names from elsewhere.

## Currently installed

The authoritative, harness-agnostic source of installed MCPs is the config
files themselves — read those first; live connection status is an optional
add-on where the agent provides it.

1. Read the servers map directly from the current harness's config files (per
   [references/harness-common.md](references/harness-common.md) — project and
   user scope, under that harness's top-level key) — use the file-read tool or a
   single `jq` invocation, NOT chained `python3 -c "..."` pipes. For each entry
   whose `command` is `npx` and whose `args` include `@jfrog/agent-guard`, show:
   display name (the entry key; but where the harness uses a slug key — e.g.
   Codex — use the package from `mcp=` instead, per that harness's List
   installed), package (`mcp=` in `_JF_ARGS`), server ID (value after
   `--server`), scope (project / user).
2. **If the harness exposes an MCP status command or view** (the harness-config
   "List installed" column — e.g. Claude Code's `claude mcp list`, Cursor/VS
   Code's MCP UI), use it to add live connection status per server. If none
   exists, skip this — the config read above is still complete.
3. If a configured entry does not appear in the harness's live list, it is either
   pending approval (see [Install → Step 4a](#step-4a-enable-and-verify-the-entry-mandatory))
   or filtered by a harness policy (e.g. Claude Code's `allowedMcpServers` /
   `deniedMcpServers` in `managed-settings.json`).

## Available to install

1. Determine **server** and **JFrog project key** per the Pre-flight rules.
   `--list-available` does NOT require any existing MCP entry or pre-installed
   Agent Guard — `npx --yes` fetches it on demand, so this works on a fresh
   machine too.
2. Run this ONCE — do not emit literal `[ ]` brackets. Append `--server
   <SERVER_ID>` per the Step 1 rule (omit it only on the `JFROG_URL`+token env
   path):
```
npx --yes \
  --registry <REGISTRY_URL> \
  @jfrog/agent-guard \
  --list-available \
  --project <JFROG_PROJECT_KEY> \
  --server <SERVER_ID>
```

Output is a compact TSV — a header line, then one server per line:
`name<TAB>type<TAB>version<TAB>description`. Present the rows directly as a
numbered table — do NOT re-run, redirect, or parse with `python3`/`jq`. `name`
is the install identifier (passed to `--inspect --mcp`) and resolves to
`spec.packageName` (for remote MCPs the two are typically identical, e.g.
`com.supabase/mcp`).

3. **Mark rows already installed rather than dropping them.** For local MCPs the
   catalog `name` and the installed `spec.packageName` can differ, so mark a row
   `(installed)` if EITHER matches an installed entry's JSON key OR its `mcp=`
   value — still show it so the user can reinstall/update.

See [references/key-rules-and-troubleshooting.md](references/key-rules-and-troubleshooting.md)
for key rules and troubleshooting.

---

# Remove an MCP

Removal edits local config only and never calls the catalog, so it proceeds even
on Step 0 Exit 2 (registry disabled).

1. **Locate the entry across both scopes first.** Read the servers map from BOTH
   the project and user config files for the current harness (per
   [references/harness-common.md](references/harness-common.md), under that
   harness's top-level key), and list every exact match by name with its scope.
   Then:
   - Exactly one match → delete that entry.
   - Present in both scopes (duplicate) → tell the user it exists in both and
     ask whether to remove both or just one before editing either file.
   - No match → say so; do not edit anything.

   Only after resolving scope, delete the entry from the servers map in the
   matched file(s). **If the harness file has a "Remove cleanup" section** (e.g.
   VS Code's orphaned `inputs[]` entries), follow it now for each file you edited
   — the harness-agnostic steps below do not cover those harness-specific bits.
2. **OAuth cache — only after every matching entry is gone.** The
   `~/.jfrog/jfrogmcp.conf.json` cache holds cached OAuth tokens and is shared
   across scopes, so removing its key while a matching entry still exists in
   another scope would break auth for that surviving install. **This file
   contains secrets — never print, echo, or surface its contents when reading or
   editing it; operate on it by key only.** So:
   - If no entry matched in step 1, skip this step entirely.
   - If a matching entry remains in the other scope (user kept only one of a
     duplicate), leave the cache key in place.
   - Only when all matching project and user entries have been deleted (or the
     user explicitly asks to clear cached credentials), read
     `~/.jfrog/jfrogmcp.conf.json` and delete, from the `servers` object, the key
     equal to this MCP's `spec.packageName` (the same identifier used as the JSON
     key of the config entry you removed above). If that exact key is absent, do
     nothing — do NOT guess or delete a similarly-named key. Then write the file
     back. Reading the KEY NAMES under `servers` to locate the match is allowed;
     what is forbidden is printing, echoing, quoting, or summarizing any VALUE in
     the file, or surfacing the surrounding entries — read the minimum needed to
     locate the key and remove it. If the file is absent, skip silently.
3. **Mandatory:** tell the user the exact restart action from the harness's
   **Restart** column (per [references/harness-common.md](references/harness-common.md))
   — not just "restart the agent" — so the removed entry stops loading.
