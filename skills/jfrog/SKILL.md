---
name: jfrog
description: >-
  Interact with the JFrog Platform via the JFrog CLI, JFrog MCP server and REST/GraphQL APIs.
  Use this skill when the user wants to manage Artifactory repositories,
  upload or download artifacts, manage builds, configure permissions,
  manage users and groups, work with access tokens, configure JFrog CLI
  servers, search artifacts, manage properties, set up replication,
  manage JFrog Projects, run security audits or scans, look up CVE details,
  query exposures scan results from JFrog Advanced Security, manage
  release bundles and lifecycle operations, aggregate or export platform
  data, or perform any JFrog Platform administration task.
  Also use when the user mentions jf, jfrog, artifactory, xray, distribution,
  evidence, apptrust, onemodel, graphql, workers, mission control, curation,
  advanced security, exposures, or any JFrog product name.
  Do NOT use this skill to install, add, remove, list, or manage MCP servers.
compatibility: >-
  Requires bash, jq, and awk on PATH. The JFrog CLI (jf) is required for Tier 2
  (CLI) and Tier 3 (jf api) operations; without it, only MCP (Tier 1) is available.
metadata:
  role: base
  version: "0.31.0"
---

# JFrog Skill

The foundational skill for all JFrog agent interactions. Covers JFrog Platform concepts, `jf` CLI setup and authentication, and intent routing to workflow skills.

## At a glance (always-read core)

Network-facing `jf` this session. Exempt until `<SID>`: `jf --version`,
`jf config show`.

**Tier A — always-read floor** (before first *non-exempt* `jf`):

- **UA:** [Environment check](#environment-check) once → on exit 0/1, export
  its **exact stdout line** as `JFROG_CLI_USER_AGENT` atop every bash that
  runs `jf` (never invent / rebuild the UA)
- **CLI offer:** after [Environment check](#environment-check) exit 0/1
  (skip `jfrog-init` / MCP-only). `NEWER_AVAILABLE` → stop, Yes/No; SKIP/No → silent
- **Server:** resolve default once → `--server-id <SID>` **after** subcommand
  (`jf api --server-id …`, never `jf --server-id … api`). One request → one
  server (unless user names servers, e.g. `compare <a> and <b>`)
- **Error (401/403/404/timeout):** stop — never retry another server / never
  infer multi-server. Override only if user names a server
- **No prep mutations:** missing repo/artifact/build → stop + report; no
  create/copy/move/upload to fill the gap (workaround ask ≠ permission)
- **Never guess** tools / `jf api` paths → tool list / `--help` / `references/`.
  404 → stop (no guessed retry). `jf api` needs product prefix
  (`/artifactory`, `/xray`, …)
- **Hard-rule signals:** [Cautious execution](#cautious-execution),
  [Server selection rules](#server-selection-rules-mandatory),
  [Gotchas](#gotchas--hard-rules-never-skip) Tier A bullets below — not tips
- **Gotcha floor (Tier A):** never interactive (`jf config add`, `jf login`,
  template wizards, …); if a call fails **with** `--server-id`, do **not**
  retry without it; 401/403/404/timeout → stop, never hop servers; `--quiet`
  is not global — check `--help` before adding it

**Tier B — path-gated MUST** (before `jf api` / AQL / advanced CLI I/O /
MCP-result-via-shell anti-patterns): full
[`references/cli-gotchas.md`](references/cli-gotchas.md),
[`references/jf-api.md`](references/jf-api.md),
[`references/preserving-command-output.md`](references/preserving-command-output.md),
[`references/cli-command-discovery.md`](references/cli-command-discovery.md).
Setup / `jf setup` / ordinary CLI do **not** require Tier B.

**Tier C — on-demand:** [`references/INDEX.md`](references/INDEX.md) domain
refs; login / CLI install when needed.

Contents (prefer full SKILL.md; At a glance = Tier A floor if you only see the
top):

| Section | Topic |
|---------|-------|
| [Tool selection strategy](#tool-selection-strategy) | MCP vs CLI vs `jf api` |
| [Prerequisites](#prerequisites), [Environment check](#environment-check) | before first non-exempt `jf` |
| [Cautious execution](#cautious-execution), [Server selection rules](#server-selection-rules-mandatory) | **Tier A hard rules** |
| [Gotchas — hard rules](#gotchas--hard-rules-never-skip) | Tier A reminders; full `cli-gotchas.md` = **Tier B** |
| [Path-gated base references](#path-gated-base-references-must-before-jf-api--advanced-cli) | **Tier B MUST** before `jf api` / advanced CLI |
| [When to read reference files](#when-to-read-reference-files) → [`references/INDEX.md`](references/INDEX.md) | Tier C domain refs |
| [Command discovery](#command-discovery) / [jf api](#invoking-platform-apis-with-jf-api) | Tier B when those paths apply |
| [Structured inputs](#structured-inputs) / [Batch](#batch-and-parallel-execution) / [Preserving output](#preserving-command-output) | templates / parallel / temp files |

> **Floor for partial reads:** Tier A (this section) before first non-exempt
> `jf`. Prefer the full SKILL.md when you can. Load **Tier B** only when the
> next action needs `jf api` / AQL / advanced CLI I/O (checklist). Domain
> detail → Tier C [`references/INDEX.md`](references/INDEX.md).

Interact with the JFrog Platform through three tool tiers — see
[Tool selection strategy](#tool-selection-strategy). In code examples,
`<skill_path>` is this skill's directory, resolved automatically by the agent.
If unresolved, locate this SKILL.md file and use its parent directory.

> **Out of scope: MCP server management.** Installing, listing, removing, or
> configuring MCP servers (e.g. "install an MCP", "what MCPs can I install",
> "list my MCPs", "which MCP servers can I use", "what's in my approved MCP
> catalog") is handled by the JFrog Agent Guard workflow
> (`@jfrog/agent-guard`) — a separate workflow, not this skill.

## Tool selection strategy

Try the tiers in order; move to the next only when the current does not
cover the operation or fails:

1. **JFrog MCP tools** (preferred): `CallMcpTool` against the JFrog MCP
   server. Discover available tools from the server's tool list; never
   guess tool names.
2. **`jf` CLI subcommands** (fallback): dedicated commands such as
   `jf rt upload`, `jf rt dl`, `jf build-publish`.
3. **`jf api`** (last resort): REST/GraphQL endpoints with no dedicated
   subcommand. Validate the path first — see rule 6 in
   [Cautious execution](#cautious-execution).

MCP and CLI may use different token scopes. One tier returns 403 → try the
other tier before reporting the operation blocked.

## Prerequisites

The following tools must be available on `PATH`:

| Tool | Purpose |
|------|---------|
| `jq` | JSON parsing of CLI and API output |

All JFrog HTTP traffic from Tiers 2 and 3 goes through the `jf` CLI itself
(`jf api`, see [Invoking platform APIs with `jf api`](#invoking-platform-apis-with-jf-api) below) —
no standalone `curl` is required for any JFrog interaction.

**Runtime permission for JFrog calls.** All `jf` calls that touch the network
need an outbound-HTTPS escalation from the agent runtime. The `~/.jfrog/`
credential save (`jf config add` during login) additionally needs a
filesystem-write escalation.

| Runtime     | Network                                       | Network + `~/.jfrog/` write     |
| ----------- | --------------------------------------------- | ------------------------------- |
| Cursor      | `required_permissions: ["full_network"]`      | `required_permissions: ["all"]` |
| Claude Code | `allowed-tools: Bash(jf:*)` + host allowlist  | same + filesystem allowlist     |
| Other       | Configure at the runtime/sandbox layer        | same                            |

If `jf` exits 1 with empty output, the runtime's network gate is the first
thing to check — re-run with the appropriate escalation above.

## Environment check

MCP (Tier 1) skips this check — proceed immediately. Before your first Tier 2
or Tier 3 (`jf`) operation this session, run the environment check. On exit
0/1, **remember its stdout line verbatim** as `<UA>` for the rest of the
session. Skip the CLI offer during `jfrog-init`.

```bash
bash <skill_path>/scripts/check-environment.sh <model-slug>
# exit 0/1 stdout: exactly one opaque line — that line IS <UA>. Copy it byte-for-byte.
# Do not parse, rebuild, or approximate the export value from this comment.
# stderr: JSON state (cached 24h at ${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}/skills-cache/jfrog-skill-state.json)
```

Then, on exit 0/1 only:

```bash
bash <skill_path>/scripts/cli-newer-version-offer.sh
# SKIP → continue the original task; do not mention the offer.
# NEWER_AVAILABLE <cli_version> <latest> (suggest_upgrade) → stop; Yes / No. After:
#   bash <skill_path>/scripts/cli-newer-version-offer.sh --clear
# Yes → references/jfrog-cli-install-upgrade.md, then check-environment.sh --force
# (Tier 2/3 only on exit 0/1). No → silent. Next offer = next new latest.
```

Exit 2/3 produces no `<UA>`; follow the exit table below and do not proceed to
Tier 2 or 3.

Pass your own model slug, lowercased, with version (e.g. `opus-4.7`,
`gpt-5.6-sol`, `gemini-2.5-pro`, `composer-2-fast`). Examples, not an
allowlist — emit a new/unlisted name verbatim, not `unknown`. Not
harness/role (`subagent`, `agent`) or bare family (`claude`, `gpt`);
subagents inherit the parent's slug. `unknown` only if truly unidentifiable.

### Never invent `JFROG_CLI_USER_AGENT`

On exit 0/1, the script's stdout line **is** `<UA>` — export it verbatim (never
invent, rebuild, or edit it). On exit 2/3 there is no `<UA>` — do not synthesize
one. Current stdout starts with `jfrog-skills/`, never with `model/`.

- **Parent session:** if `<UA>` is missing or starts with `model/` (legacy),
  discard it and **re-run** `check-environment.sh`. Export the new exit 0/1
  stdout line only when it does **not** start with `model/`; otherwise **stop**
  (do not invent).
- **Subagents:** use only the parent-passed exact `<UA>` — never re-run the
  script or construct a replacement. If that value is missing or starts with
  `model/`, **stop** (do not export / do not invent); do not re-run.

### Export `JFROG_CLI_USER_AGENT` once per bash invocation

At the top of every bash invocation that runs `jf`, export `<UA>` once;
all `jf` calls in that invocation pick it up:

```bash
export JFROG_CLI_USER_AGENT='<UA>'
export JFROG_CLI_AI_MODEL='<model-slug>'   # jf >= 2.120.0 emits ai-model/<slug> from this
jf config show
jf api /artifactory/api/system/version
```

`JFROG_CLI_AI_MODEL` carries the model the CLI cannot infer from the environment;
export it alongside `<UA>` (same `<model-slug>` you passed the script). Older CLIs
ignore it; the remembered `<UA>` already carries the slug when the script
recorded one.

Do **not** repeat the assignment per `jf` call (`JFROG_CLI_USER_AGENT='<UA>' jf …`
on every line). This is a **session-global invariant**: it applies to *every*
`jf` invocation in the session, including `jf` calls you make while following
any workflow skill that builds on this base skill. Examples elsewhere in this
skill and in `references/*.md` omit the export for readability — the rule is
global. When launching a subagent, pass `<UA>` in its prompt (see
[Never invent](#never-invent-jfrog_cli_user_agent)) and whether the CLI
offer already ran. Subagents do not re-ask.

| Exit | Meaning |
|------|---------|
| 0 | Cache fresh — CLI ready (Tiers 2 and 3 available), proceed |
| 1 | Cache refreshed — CLI ready (Tiers 2 and 3 available), proceed |
| 2 | `jf` not installed — Tiers 2 and 3 unavailable; only MCP (Tier 1) remains |
| 3 | `jf` below minimum version — Tiers 2 and 3 unavailable; only MCP (Tier 1) remains |

Exit 2 or 3 prints no `<UA>` on stdout. Do not invent or hand-assemble one
from this file or from `jf --version`.

Exit 2 or 3 is not a fatal error. Attempt to install or upgrade the CLI
(see `references/jfrog-cli-install-upgrade.md`). If installation succeeds,
re-run the environment check. If installation is not possible (no permissions,
restricted environment), proceed with MCP (Tier 1) only. Both `jf` CLI commands
(Tier 2) and `jf api` (Tier 3) require a working `jf` installation.

### JSON parsing (`jq`)

Use **`jq`** for all JSON parsing of CLI and API output (pipes, `-r`, filters).

## `~/.jfrog/skills-cache/` — allowed files only

`${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}/skills-cache/` is **not** a general scratch
or temp directory. Use it **only** for these two artifacts:

1. **`jfrog-skill-state.json`** — written by `scripts/check-environment.sh`
   (24-hour CLI check cache).
2. **`onemodel-schema-${JFROG_SERVER_ID}.graphql`** — cached OneModel supergraph
   schema (see `references/onemodel-graphql.md`).

**Do not** save HTTP response bodies, GraphQL query results, ad-hoc JSON, reports,
or any other temporary files under `skills-cache/`. Write those to a host temp
path instead (for example `/tmp/<name>-$$.json` or `mktemp -d`), echo the path
when a follow-up Shell step must read the file — same pattern as *Preserving
command output* below.

## Cautious execution

**HARD RULES — never skip.** Speculative / preparatory / guessed ops are
forbidden. Before any JFrog CLI command, MCP tool call, or API call:

1. Confirm the operation is needed to fulfill the user's request.
   If the request is ambiguous or could refer to multiple systems (e.g.
   "builds" could mean Artifactory build-info or CI/CD pipeline runs),
   **ask the user for clarification** instead of guessing. Never fetch data
   from the wrong system — a wrong answer is worse than asking a question.
2. Resolve the target server using the **Server selection rules** below —
   there must be no ambiguity about which server is used
3. For mutating operations (create, update, delete, upload), confirm with the
   user unless the intent is clearly implied. This applies to all tiers
   (MCP tools, CLI commands, and `jf api` with POST/PUT/DELETE).
4. Prefer read operations first to understand current state before making changes
5. **Never invent preparatory mutations.** If the requested operation fails
   because a precondition is not met (artifact missing from the specified repo,
   repository does not exist, package not at the expected location, build not
   found), **stop and report the gap to the user**. Do not perform copy, move,
   upload, create-repo, or any other mutating operation to satisfy the
   precondition. "Put it there so the download succeeds", "make it work", or
   "do whatever you need" is still a workaround — not permission to invent
   the missing artifact. Only perform that mutation when it **is** the
   user's requested work (publish this file, create this repo, move this
   artifact), not a helper to make a different operation succeed. These
   "helper" mutations
   can have cascading effects the user has not considered — virtual repository
   resolution changes, storage quota consumption, replication triggers, Xray
   re-indexing, or permission propagation.
6. **Never guess tool names or API paths.** For MCP tools, confirm the tool
   exists in the server's tool list. For `jf api` paths, validate against
   `<skill_path>/references/` (or
   [JFrog OpenAPI specifications](https://docs.jfrog.com/integrations/docs/openapi-specifications)
   if you have web access). On a 404, stop and report — never retry with a guessed
   alternative path.

## Server selection rules (mandatory)

**HARD RULES — never skip or soften.** Wrong-server answers and silent
server-switching are worse than stopping to ask.

**Single-server invariant.** After `<SID>` is resolved, every subsequent
network-facing `jf` call MUST pass `--server-id <SID>` (default resolved below);
bootstrap `jf --version` / `jf config show` stay exempt until then. For one user
request, all network `jf` calls use **exactly one** server-id — unless the user
names servers to compare (e.g. `compare <a> and <b>`), where each call passes
its own target's `--server-id`.

**JFrog MCP and CLI use independent auth.** MCP tools authenticate through
the MCP server session (not `jf config`); CLI commands authenticate through
`jf config`. If you switch the CLI target server via `jf config use`, the
MCP connection still points to its original server. Do not mix MCP and CLI
calls targeting different servers in the same session. If the user asks to
switch servers, warn that MCP tools will continue to target the original
server until the MCP connection is re-established.

**MUST NOT** retry on a second configured server after 401/403/404, empty, or
partial results; **MUST NOT** infer multi-server intent from "my"/"our" or
from seeing extra entries in `jf config show`. **Override:** only when the user
**explicitly** names another id ("on `<id>`, …", "use `<id>`", "compare `<a>`
and `<b>`") — inferred intent is not an override.

### Resolve the default once per session

Before your first `jf` call, resolve the default server-id and **remember it**
as `<SID>` for the rest of the session, same pattern as `<UA>`:

```bash
jf config show 2>/dev/null \
  | awk '/^Server ID:/{id=$NF} /^Default:[[:space:]]*true/{print id; exit}'
# stdout: the default server-id; if empty, stop and ask which to use
```

Pass `--server-id <SID>` to every subsequent `jf` call. The flag goes
**after** the subcommand name, not after `jf` itself:

- ✅ `jf api --server-id <SID> /artifactory/api/system/version`
- ✅ `jf rt ping --server-id <SID>`
- ❌ `jf --server-id <SID> api /…` — fails with `flag provided but not defined`

When launching a subagent, pass `<SID>` in its prompt — subagents do not
re-resolve. Examples elsewhere in this skill and in `references/*.md` omit
`--server-id` for readability; the rule is global, same as
`JFROG_CLI_USER_AGENT`. To add a new server, read
`references/jfrog-login-flow.md`.

### On any error, stop — never switch

If a `jf` call returns 401/403, 404, network error, timeout, or any other
failure, **stop with no further `jf` calls** and respond:

> `<server-id>` returned `<code>` for `<endpoint>`: `<short reason>`. Other
> configured server(s): `<list>` — I won't query them without your explicit
> instruction. How would you like to proceed?

## Path-gated base references (MUST before `jf api` / advanced CLI)

These four files **are Tier B of the base skill** — content that used to live
in this SKILL.md. They are **not** optional INDEX domain lookups, and they are
**not** required before every CLI / setup path.

**MUST read every one in full before** `jf api`, AQL via `jf api`, advanced
CLI I/O (temp-file / stdout-stderr patterns), or acting on MCP results via
shell/`jq`. Ordinary `jf` (e.g. `jf setup`, `jf rt …` with known flags) needs
**Tier A only** ([At a glance](#at-a-glance-always-read-core)).

The short [Gotchas](#gotchas--hard-rules-never-skip) Tier A bullets are the
session floor — **they do not replace** full
[`references/cli-gotchas.md`](references/cli-gotchas.md) when you enter Tier B.

| Tier B — MUST read in full (path-gated) | Covers |
|-----------------------------------------|--------|
| [`references/cli-gotchas.md`](references/cli-gotchas.md) | gotchas, caveats, known issues, do/don't, I/O & auth traps |
| [`references/jf-api.md`](references/jf-api.md) | product-prefix table, flags, examples, GraphQL payload |
| [`references/preserving-command-output.md`](references/preserving-command-output.md) | temp files, `$$` paths, no re-fetch for `jq` |
| [`references/cli-command-discovery.md`](references/cli-command-discovery.md) | namespaces, top-level cmds, Pipelines sunset |

Skipping any of these **on a Tier B path** = incomplete base-skill load /
hard-rule violation. Skipping them on a Tier A-only path (setup / simple CLI)
is **not** a violation.

## When to read reference files

Prefer reading this SKILL.md in full. [At a glance](#at-a-glance-always-read-core)
is the **Tier A** floor for partial readers. **Path-gated base references**
above are **Tier B** (mandatory on those paths, not every session). Everything
else under [`references/INDEX.md`](references/INDEX.md) is **Tier C** domain
detail — load ≤2–3 most specific files for the task; skip unused domains.

`references/INDEX.md` lists every `references/*.md` file (Tier B + Tier C).
Add/rename/remove a file → update INDEX in the same change — CI
(`tests/jfrog/test_reference_index_contract.py`) fails if they diverge.
## Command discovery

Run `--help` to verify options — do not rely on memorized commands.

1. `jf --help` → 2. `jf <namespace> --help` → 3. `jf <command> --help`

**Tier B — MUST read in full before relying on discovery beyond `--help`:**
[`references/cli-command-discovery.md`](references/cli-command-discovery.md)
(namespaces, top-level lifecycle/security commands, Pipelines sunset).

## Invoking platform APIs with `jf api`

Tier 3 for Platform REST/GraphQL, auto-authenticated. **Do not use
`jf rt curl` / `jf xr curl`.** Always include the **product prefix**
(`/artifactory`, `/xray`, `/access`, …) — omit → 404.

**Tier B — MUST read in full before `jf api`:**
[`references/jf-api.md`](references/jf-api.md)
(prefixes, flags, examples, OneModel GraphQL payload). Body on stdout / status
on stderr — see [Gotchas](#gotchas--hard-rules-never-skip) + full
`cli-gotchas.md` (Tier B).
## Structured inputs

Interactive wizards (`jf rt rpt` / `ptt` / `rplt`) are unusable for agents.
Fetch an existing config via REST and edit:

```bash
jf api /artifactory/api/repositories/<repo-key>
```

More REST/template patterns → `references/artifactory-api-gaps.md` or
`references/platform-admin-api-gaps.md` via [`references/INDEX.md`](references/INDEX.md).

## Gotchas — hard rules (never skip)

**Not tips.** Tier A bullets below are the always-read floor. Full
[`references/cli-gotchas.md`](references/cli-gotchas.md) is **Tier B** —
**MUST** before `jf api` / AQL / advanced CLI I/O / MCP-via-shell; **not**
required before every CLI or `jf setup`. Short bullets do **not** replace the
full file on Tier B paths.

**Tier A floor (every non-exempt `jf` session):**

- **`--quiet`** is not global — check `--help` before adding it
- **`--server-id`:** if a call fails with it, do not retry without it (silent
  default-server switch). See [Server selection rules](#server-selection-rules-mandatory)
- **Non-interactive only** — avoid `jf config add`, `jf login`, `*template`
  wizards; use `references/jfrog-login-flow.md` / REST
- **Auth errors:** 401 → re-login **same** server; 403 → permissions; 404 →
  path/prefix/version. Never switch configured servers as a workaround

**Tier B reminders (load full `cli-gotchas.md` + sibling Tier B refs before
these paths):**

- **MCP:** read structured tool results directly — do not pipe through shell/`jq`
- **`jf api` I/O:** body → stdout, status → stderr; pipe stdout to `jq`;
  **never `2>&1 | jq`**. No `-L` / `-o` — redirect: `jf api … > /tmp/out-$$.json`
- **Product prefix** required on every `jf api` path (see Tier B `jf-api.md`)
- **Never re-fetch to retry `jq`** — save output first
  ([Preserving command output](#preserving-command-output) + Tier B
  `preserving-command-output.md`)
## Batch and parallel execution

Independent ops → lightest parallelism: (1) loops/`&` in one Shell, (2) parallel
Shell calls, (3) subagents for large fan-out. Details →
`references/general-parallel-execution.md`.

## Preserving command output

Save network responses to a temp file; echo the path; re-read for `jq` — never
re-run the same network call to fix parsing.

**Tier B — MUST read in full before advanced I/O / re-parse patterns:**
[`references/preserving-command-output.md`](references/preserving-command-output.md)
(`$$` + echo, session id, no re-fetch / no cross-context reuse).

## Before you run `jf` — quick checklist

[At a glance](#at-a-glance-always-read-core) **Tier A** floor; add **Tier B**
only when the next action needs `jf api` / advanced CLI:

- [ ] `export JFROG_CLI_USER_AGENT='<UA>'` in this bash — `<UA>` is the exact
      stdout line from `check-environment.sh` exit 0/1 (never invent / rebuild)
- [ ] CLI offer (`cli-newer-version-offer.sh`) done or N/A (`jfrog-init` / MCP-only)
- [ ] network `jf`: `--server-id <SID>` after subcommand (not `jf --version` /
      `jf config show` pre-SID)
- [ ] one server; error → stop, don't switch (multi only if user names /
      `compare`)
- [ ] no prep create/copy/move/upload to fill a gap (workaround ask ≠ permission)
- [ ] never guess tools/paths → list / `--help` / `references/`; 404 → stop;
      `jf api` product prefix (`/artifactory`, `/xray`, …)
- [ ] **Tier A** hard rules: Cautious execution + Server selection + Gotchas
      Tier A floor (interactive / `--server-id` retry / stop-on-error /
      `--quiet`)
- [ ] **Tier B** (only if next action is `jf api` / AQL / advanced CLI I/O):
      full `cli-gotchas.md`, `jf-api.md`, `preserving-command-output.md`,
      `cli-command-discovery.md`
