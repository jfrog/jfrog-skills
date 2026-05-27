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
compatibility: >-
  Requires jq on PATH.
metadata:
  role: base
  version: "0.11.0"
---

# JFrog Skill

The foundational skill for all JFrog agent interactions. Covers JFrog Platform concepts, `jf` CLI setup and authentication, and intent routing to workflow skills.

Interact with the JFrog Platform through three tool tiers — see
[Tool selection strategy](#tool-selection-strategy). In code examples below,
`<skill_path>` refers to this skill's directory and is resolved automatically
by the agent. If the agent does not resolve it, determine the path by locating
this SKILL.md file and using its parent directory.

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

MCP and the CLI may use different token scopes. If one tier returns 403,
try the alternate tier before reporting the operation blocked.

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

MCP (Tier 1) operations do not require this check and can proceed immediately.
Before your first Tier 2 or Tier 3 (`jf`) operation in a session, run the
environment check and **remember its stdout** as `<UA>` for the rest of the
session:

```bash
bash <skill_path>/scripts/check-environment.sh <model-slug>
# stdout (one line): jfrog-skills/<version> [(tool=<harness>; model=<model-slug>)] jfrog-cli-go/<cli-version>
# stderr: JSON state (cached 24h at ${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}/skills-cache/jfrog-skill-state.json)
```

Pass the precise underlying-model slug with version: `opus-4.7`,
`sonnet-4.5`, `gpt-5-codex`, `gemini-2.5-pro`, `composer-2-fast`. Cursor's
Composer product slug **is** the canonical id — use it as-is. Do **not**
pass harness/role names (`subagent`, `agent`, `assistant`) or bare family
names (`claude`, `gpt`); subagents inherit the parent's slug. If genuinely
unknown, pass `unknown`.

### Export `JFROG_CLI_USER_AGENT` once per bash invocation

At the top of every bash invocation that runs `jf`, export `<UA>` once;
all `jf` calls in that invocation pick it up:

```bash
export JFROG_CLI_USER_AGENT='<UA>'
jf config show
jf api /artifactory/api/system/version
```

Do **not** repeat the assignment per `jf` call (`JFROG_CLI_USER_AGENT='<UA>' jf …`
on every line). Examples elsewhere in this skill and in `references/*.md`
omit the export for readability — the rule is global. When launching a
subagent, pass `<UA>` in its prompt; subagents do not re-run the script.

| Exit | Meaning |
|------|---------|
| 0 | Cache fresh — CLI ready (Tiers 2 and 3 available), proceed |
| 1 | Cache refreshed — CLI ready (Tiers 2 and 3 available), proceed |
| 2 | `jf` not installed — Tiers 2 and 3 unavailable; only MCP (Tier 1) remains |
| 3 | `jf` below minimum version — Tiers 2 and 3 unavailable; only MCP (Tier 1) remains |

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

Do not run commands speculatively. Before executing any JFrog CLI command,
MCP tool call, or API call:

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
   precondition unless the user explicitly asks for it. These "helper" mutations
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

**Single-server invariant.** Every `jf` call MUST pass `--server-id <SID>`
(default resolved below); for one user request, all `jf` calls use **exactly
one** server-id. A wrong answer from the wrong server is worse than a stop-and-ask.

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

## When to read reference files

Load the most specific file for the task at hand. Avoid loading more than 2-3
reference files for a single operation — start with the most relevant one and
only load additional files if the first doesn't cover the need. File sizes
vary (~25–640 lines); larger files are noted with approximate line counts
below.

### Cross-domain

- **Disambiguating a JFrog entity, understanding entity types, or planning operations that span multiple products**: read `references/jfrog-entity-index.md`, then follow pointers to the relevant domain file
- **Looking up documentation URLs**: read `references/jfrog-url-references.md`

### Artifactory

- **Repository types, artifacts, builds, properties, or permission targets (concepts)**: read `references/artifactory-entities.md` (~220 lines)
- **Stored packages, package versions, version locations, or the metadata layer over Artifactory (concepts)**: read `references/stored-packages-entities.md` (~165 lines)
- **Repo, file, build, permission, user/group, or replication operations**: if the JFrog MCP server exposes a tool for the operation, prefer it. For CLI/API fallback, read `references/artifactory-operations.md` (for **listing builds** use AQL with `limit`/`offset` — see § *Listing build names*; for **full build detail** use `GET /api/build/<name>/<number>?project=` — see § *Retrieving full build info*)
- **AQL queries**: read `references/artifactory-aql-syntax.md` (~585 lines)
- **Artifactory REST beyond the CLI, structured JSON templates (replacing interactive wizards), or any Artifactory API gap**: read `references/artifactory-api-gaps.md` (~220 lines)

### Xray & security

- **Watches, policies, violations, components, or vulnerability scanning (concepts)**: read `references/xray-entities.md` (~290 lines)
- **Exposures scanning results (secrets, IaC, service misconfigurations, application security risks)**: read `references/xray-entities.md` § Exposures (Advanced Security)
- **Curation audit events (approved/blocked packages, dry-run policy evaluations, curation export)**: read `references/xray-entities.md` § Curation audit events

### Release lifecycle & distribution

- **Release bundles, lifecycle stages, distribution, or evidence (concepts)**: read `references/release-lifecycle-entities.md` (~180 lines)
- **Applications, application versions, releasables, promotions, or AppTrust (concepts)**: read `references/apptrust-entities.md` (~155 lines)

### Catalog

- **Public or custom catalog, package metadata, vulnerability advisories, licenses, OpenSSF, or MCP services (concepts)**: if the JFrog MCP server exposes a catalog tool, prefer it for single-package lookups. For deeper queries, read `references/catalog-entities.md` (~190 lines)
- **CVE details, vulnerability lookup by CVE ID, or severity/affected-packages/fix-versions for a specific CVE**: prefer an MCP vulnerability-lookup tool if the JFrog MCP server exposes one. Otherwise read `references/onemodel-query-examples.md` § *Public security domain* for the `searchVulnerabilities` query shape — this is self-contained; do not load the `jfrog-package-safety-and-download` skill for pure CVE lookups

### OneModel (GraphQL)

- **GraphQL queries** (applications, packages, evidence, release bundles, catalog, cross-domain, or "list/search my" platform entities): read `references/onemodel-graphql.md` (~325 lines)
- **Query templates and domain-specific examples**: read `references/onemodel-query-examples.md` (~555 lines)
- **Pagination, filtering, GraphQL variables, or date formatting**: read `references/onemodel-common-patterns.md` (~280 lines)

### Platform administration

- **Platform structure, project/repo membership, or project roles vs environments (concepts)**: read `references/platform-access-entities.md`
- **Access tokens, stats, projects, or system health**: read `references/platform-admin-operations.md`
- **Managing JFrog Projects, members, or environments**: read `references/projects-api.md` (~260 lines)
- **Platform REST beyond the CLI, or any platform-level API gap**: read `references/platform-admin-api-gaps.md` (~180 lines)

### CLI setup & authentication

- **Adding a server or logging in**: read `references/jfrog-login-flow.md` (~130 lines)
- **CLI not installed, upgrade needed, or `jq` unavailable**: read `references/jfrog-cli-install-upgrade.md`

### General patterns

- **Batching, parallel Shell calls, or launching subagents**: read `references/general-parallel-execution.md` (~135 lines)
- **Large or parallel data gathering, list-vs-detail APIs, cache hygiene**: read `references/general-bulk-operations-and-agent-patterns.md`
- **Standalone HTML report with JFrog-aligned styling**: read `references/jfrog-brand-html-report.md`
- **Reusable gotchas from past tasks**: read or extend `references/general-use-case-hints.md`

## Command discovery

Use the commands listed below as your primary reference. Run `--help` to
verify options you are unsure about or to discover commands not listed here —
do not rely on memorized commands outside this skill, as they may be outdated.

1. `jf --help` — list all namespaces and top-level commands
2. `jf <namespace> --help` — list subcommands in a namespace
3. `jf <command> --help` — show usage, arguments, and options

### CLI namespaces

| Namespace | Alias | Product |
|-----------|-------|---------|
| `rt` | | Artifactory |
| `xr` | | Xray |
| `ds` | | Distribution V1 |
| `at` | `apptrust` | AppTrust |
| `evd` | | Evidence |
| `mc` | | Mission Control |
| `worker` | | Workers |
| `config` | `c` | CLI server configuration |
| `plugin` | | CLI plugin management |
| `ide` | | IDE integration |

> **Sunset notice:** JFrog Pipelines has been sunset and is no longer supported.
> Do not use the `pl` CLI namespace or the Pipelines REST API
> (`/pipelines/api/...`). If a user asks about Pipelines, inform them the
> product has been sunset.

Top-level lifecycle commands (no namespace): `rbc`, `rbp`, `rbd`, `rba`,
`rbf`, `rbe`, `rbi`, `rbs`, `rbu`, `rbdell`, `rbdelr`.

Top-level security commands: `audit`, `scan`, `build-scan`, `curation-audit`,
`sbom-enrich`.

Top-level other: `access-token-create` (`atc`), `login`, `how`, `stats`,
`generate-summary-markdown`, `exchange-oidc-token`, `completion`.

## Invoking platform APIs with `jf api`

`jf api` is the Tier 3 entry point for JFrog Platform REST and GraphQL
endpoints, auto-authenticated against the resolved server. **Do not use
`jf rt curl` or `jf xr curl`**; they are superseded by `jf api`.

### Product-prefix table

`jf api` requires the **full** path including the product prefix; omitting it
returns 404.

| Product | Path prefix |
|---------|-------------|
| Artifactory | `/artifactory/api/...` |
| Xray | `/xray/api/...` |
| Access (users, groups, tokens, permissions, projects) | `/access/api/...` |
| Evidence | `/evidence/api/...` |
| Release Lifecycle | `/lifecycle/api/...` |
| AppTrust | `/apptrust/api/...` |
| Distribution | `/distribution/api/...` |
| OneModel (GraphQL) | `/onemodel/api/v1/graphql`, `/onemodel/api/v1/supergraph/schema` |
| Mission Control | `/mc/api/...` |
| Curation | `/xray/api/v1/curation/...` (lives under Xray) |

### Examples

```bash
jf api /artifactory/api/repositories
jf api --server-id <SID> /artifactory/api/system/version

# AQL (POST with text/plain body)
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" -d '<aql-query>'
```

Common flags: `-X/--method`, `-H/--header`, `-d/--data`, `--input <file>`,
`--server-id`, `--timeout`. Body on stdout, status on stderr — see
[Gotchas](#gotchas).

### GraphQL (OneModel)

OneModel is the unified GraphQL API. **Do not** embed the query inside a JSON
literal (`-d '{"query":"..."}'`) — escaping breaks requests. Build the payload
with `jq -n --arg`, pass it via `--input`, and save the response to a file
before running `jq` on it.

```bash
QUERY='{ evidence { searchEvidence(first: 5, where: { hasSubjectWith: { repositoryKey: "my-repo-local" } }) { totalCount } } }'
PAYLOAD=/tmp/onemodel-payload-$$.json RESPONSE=/tmp/onemodel-$$.json
jq -n --arg q "$QUERY" '{query:$q}' > "$PAYLOAD"
jf api /onemodel/api/v1/graphql -X POST \
  -H "Content-Type: application/json" --input "$PAYLOAD" > "$RESPONSE"
jq . "$RESPONSE"
```

Schema discovery: `jf api /onemodel/api/v1/supergraph/schema > "$SCHEMA_FILE"`
(store only under `~/.jfrog/skills-cache/`, never query responses). Read
`references/onemodel-graphql.md` for the full workflow (schema fetch,
validation, pagination, errors), plus `references/onemodel-query-examples.md`
and `references/onemodel-common-patterns.md` for query shapes, pagination,
variables, and dates.

## Structured inputs

Several CLI commands require JSON template files. The templates are normally
created by interactive wizard commands (`jf rt rpt`, `jf rt ptt`, `jf rt rplt`)
which agents cannot use. Instead, retrieve an existing config via REST API as a
starting point and modify it:

```bash
jf api /artifactory/api/repositories/<repo-key>
```

For other Artifactory or platform REST patterns, or when you need more than
this repo GET, see **Any API gap** under [When to read reference files](#when-to-read-reference-files).

## Gotchas

### MCP tools

- MCP tools return structured data in the tool result. Read response fields
  directly; do not pipe MCP output through shell commands or `jq`.

### CLI and `jf api`

- `jf api` requires the **product prefix** in the path. Omitting it returns
  404. See the [product-prefix table](#product-prefix-table) for the full list.
- `jf api` writes the body (success or error JSON) to **stdout** and
  `[Info] Http Status: NNN` to **stderr** on every call; non-2xx also exits
  1 and adds `[Warn] jf api: <method> <url> returned NNN`. Pipe stdout to
  `jq` directly; **never `2>&1 | jq`** — stderr corrupts the JSON. To keep
  diagnostics: `jf api <path> 2>/tmp/err-$$.log | jq .`.
- `jf api` has **no `-L`** (follow redirects) and **no `-o`** (output file).
  Save bodies with shell redirection
  (`jf api ... > /tmp/out-$$.json`); for
  binary downloads through the Artifactory remote proxy prefer `jf rt dl`,
  which handles the cache and redirect semantics natively.
- Remote repository content is stored in a `-cache` suffixed repo. Properties
  and AQL queries for remote repo artifacts must target the cache repo.
  Conversely, `/api/repositories/<key>` only accepts the parent remote key
  (without `-cache`) — strip the suffix for configuration lookups.
- **Do not use `jf rt search`** — always use a direct AQL query via
  `jf api /artifactory/api/search/aql -X POST -H "Content-Type: text/plain" -d '<aql>'`.
  See `references/artifactory-aql-syntax.md`.
- Use `--quiet` flag for non-interactive execution (suppresses confirmation
  prompts). **Caution:** `--quiet` is not a global flag — commands that do not
  support it (e.g. `jf rt s`, `jf rt ping`) will fail with misleading errors
  like "Wrong number of arguments" or "flag provided but not defined". Check
  `--help` for a command before adding `--quiet`.
- Use `--server-id` when targeting a non-default server. If a command fails
  with `--server-id`, do not retry without it — that silently targets the
  default server instead. See [Server selection rules](#server-selection-rules-mandatory).
- Never use interactive commands. All JFrog CLI operations must be performed
  non-interactively. Known interactive commands to avoid: `jf config add`,
  `jf login`, `jf rt repo-template`, `jf rt permission-target-template`, and
  `jf rt replication-template`. For server setup, follow `references/jfrog-login-flow.md`.
  For templates, use JSON schemas or REST API. If a command prompts for input
  unexpectedly, find the non-interactive alternative via `--help` or REST API.
- `jf config export` output is base64-encoded JSON. Decode with
  `base64 -d | jq` to extract fields.
- Build info lookups require a scope (`?buildRepo=` or `?project=`) —
  resolve it before calling the API. See `references/artifactory-operations.md`
  §Retrieving build info for the full workflow.
- If a `jf api` call returns 401, the configured token may have expired or
  been rotated — ask the user to re-run the login flow (see
  `references/jfrog-login-flow.md`) for the **same** server. If 403, the
  token lacks required permissions. If 404, verify the endpoint path
  (especially the product prefix) and target server version. On any of
  these errors, do not try a different configured server as a workaround —
  that targets a different environment. Report the error and ask the user.
- **Xray contextual analysis:** the summary artifact response has two
  applicability fields — `applicability` (top-level, often null) and
  `applicability_details` (always present with a `result` string). **Use
  `applicability_details[].result` for counts and summaries.** Using the
  top-level `applicability` field for aggregation produces wrong counts because
  it is null when no scanner exists. See `references/xray-entities.md`
  §Contextual analysis for the eight possible result values and jq snippets.
- **OneModel GraphQL:** always fetch the supergraph schema from the **same**
  server you query before building operations (schemas differ by deployment);
  cache, validate, and execute per `references/onemodel-graphql.md`.
- Never duplicate a network-fetching command to retry `jq` parsing — save the
  response to a temp file first (see [Preserving command output](#preserving-command-output)).
- When collecting detail responses in a loop (e.g. per-repo GETs), validate
  each body with `jq -e .` before appending to a results file. One non-JSON
  or empty response corrupts a downstream `jq -s` slurp. Write validated
  lines to an NDJSON file, then `jq -s '.' file.ndjson` to produce the final
  array. See `references/general-bulk-operations-and-agent-patterns.md`.
- Accumulated edge cases from real tasks live in `references/general-use-case-hints.md`
  — read when debugging odd failures; **append** a short entry when you confirm
  a new, reusable gotcha.

## Batch and parallel execution

When a task requires multiple independent operations, use the lightest
parallelism mechanism that fits. Three tiers: (1) batch commands in a single
Shell call using loops or `&`, (2) issue parallel Shell tool calls, (3) launch
parallel subagents for large fan-out. Read `references/general-parallel-execution.md`
(~135 lines) for tier selection, examples, and subagent prompt structuring.

## Preserving command output

When a CLI command or API call returns data, redirect the output to a temporary
file so you can re-read it without re-executing the call:

```bash
OUT=/tmp/jf-repos-$$.json
jf api /artifactory/api/repositories > "$OUT"
echo "$OUT"
```

Use `$$` (the shell PID) in the filename to prevent collisions across
concurrent sessions or processes.

**Cross-call gotcha:** each Shell tool invocation runs in a new process with a
different PID, so `$$` expands to a different value in each call. Always
**echo the expanded filename** so the agent can read it from the output and
reuse the literal path in subsequent calls. Three patterns, in priority order:

1. **`$$` + echo** (preferred): use `$$` for collision safety, echo the path
   as shown above. The agent reads `/tmp/jf-repos-12345.json` from the output
   and passes that literal value to the next Shell call.
2. **Session ID**: when many files share a prefix across calls, generate an ID
   once (`SID=$(date +%s)-$$`), echo it, and reuse in later calls.
3. **Hardcoded names**: last resort — risks collisions when parallel calls or
   subagents write to the same path.

This protects against wasted round-trips when you need to retry parsing — for
example, if a `jq` filter fails or you extract the wrong field on the first
attempt. Re-read the file instead of hitting the server again.

Do **not** duplicate the same **network** request in a shell pipeline (e.g. with
`||`) only to re-run `jq` or to reveal jq diagnostics—the duplicate call
adds load on JFrog without fetching new data. Run
`jq '<filter>' /tmp/jf-*-$$.json` (or redirect stdin from the file) instead
of re-running the same `jf api` or other identical network-backed command.

Do **not** reuse saved output across unrelated steps or changed contexts (different
server, user, or intent). The file is only valid for the immediate sequence of
operations that motivated the original call.
