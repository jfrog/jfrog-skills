---
name: jfrog
version: "0.2.0"
description: >-
  Interact with the JFrog Platform via the JFrog CLI and REST/GraphQL APIs.
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
  Requires curl and jq on PATH.
metadata:
  role: base
---

# JFrog Skill

The foundational skill for all JFrog agent interactions. Covers JFrog Platform concepts, `jf` CLI setup and authentication, and intent routing to workflow skills.

Interact with the JFrog Platform through the JFrog CLI (`jf`) and, where the
CLI falls short, through REST APIs and GraphQL. In code examples below,
`<skill_path>` refers to this skill's directory and is resolved automatically
by the agent. If the agent does not resolve it, determine the path by locating
this SKILL.md file and using its parent directory.

## Prerequisites

The following tools must be available on `PATH`:

| Tool | Purpose |
|------|---------|
| `curl` | HTTP requests to JFrog REST and GraphQL APIs |
| `jq` | JSON parsing of CLI and API output |

## Environment check

Before your first JFrog operation in a session, run the environment check.
It verifies the CLI is installed, checks for updates, and exports
`JFROG_CLI_USER_AGENT` so every outbound request is identifiable:

```bash
eval "$(bash <skill_path>/scripts/check-environment.sh)"
```

The `eval` is required — the script outputs
`export JFROG_CLI_USER_AGENT='jfrog-skills/<version> jfrog-cli-go/<cli-version>'`
on stdout. The JFrog CLI picks this up natively and injects it as the
`User-Agent` header on every HTTP request. JSON state is printed to stderr
for informational purposes (also written to the cache file).

The script uses a 24-hour cache at `<skill_path>/local-cache/jfrog-skill-state.json`. If the
cache is fresh, it returns immediately. If stale or missing, it checks whether
`jf` is installed, its version, and whether a newer version is available.

- Exit 0: cache is fresh, CLI is ready
- Exit 1: cache was stale and has been refreshed, CLI is ready
- Exit 2: `jf` is not installed

Bypass the cache only when the user explicitly asks to install, upgrade, or
reconfigure the CLI.

If the CLI is missing (exit 2) or an upgrade is needed, read
`references/jfrog-cli-install-upgrade.md` for install and upgrade instructions.

### JSON parsing (`jq`)

Use **`jq`** for all JSON parsing of CLI and API output (pipes, `-r`, filters).
Examples: `base64 -d | jq -r '.url'`, `jf rt curl ... | jq '.[] | .key'`.

## Network permissions

JFrog servers are not on the default sandbox network allowlist. Every Shell
call that contacts a JFrog server — whether via `jf` CLI, `jf rt curl`,
`jf xr curl`, or plain `curl` — requires `required_permissions: ["full_network"]`.

Without this permission, commands fail silently: `jf` exits with code 1 and
empty output, `curl` returns an empty response, and downstream JSON parsing
crashes. All JFrog operations that touch the network need this permission.

### Agent execution environments

`check-environment.sh` does **not** call your JFrog server, but it may make an
outbound request to `releases.jfrog.io` for version checking and may **write**
`<skill_path>/local-cache/jfrog-skill-state.json` when the cache is stale. In a **sandboxed**
agent environment, **`full_network` alone may not suffice**: if the workspace
cannot be written, the check can fail before any JFrog call. Request
permissions that allow writing `<skill_path>/local-cache` (or run
outside a restrictive sandbox) when you see filesystem errors from the
environment check.

### `local-cache/` — allowed files only

`<skill_path>/local-cache/` is **not** a general scratch or temp directory. Use
it **only** for these two artifacts:

1. **`jfrog-skill-state.json`** — written by `scripts/check-environment.sh`
   (24-hour CLI check cache).
2. **`onemodel-schema-${JFROG_SERVER_ID}.graphql`** — cached OneModel supergraph
   schema (see `references/onemodel-graphql.md`).

**Do not** save HTTP response bodies, GraphQL query results, ad-hoc JSON, reports,
or any other temporary files under `local-cache/`. Write those to a host temp
path instead (for example `/tmp/<name>-$$.json` or `mktemp -d`), echo the path
when a follow-up Shell step must read the file — same pattern as *Preserving
command output* below.

Apply `full_network` on the **first** Shell call that hits JFrog. Once
granted for a session, the agent environment typically retains it for
subsequent calls, but always include it explicitly to avoid silent failures.

## Server management

Server configuration is always read live from `jf config` (never cached).

- **List servers**: `jf config show` (local operation, no network needed)
- **Use a specific server**: pass `--server-id <id>` to any command
- **Switch default**: `jf config use <server-id>`
- **Add a new server**: read `references/jfrog-login-flow.md` for the full
  login procedure (web login or manual token setup)

### Server selection rules (mandatory)

Exactly one server (or an explicit set of servers) must be resolved before any
operation. The rules are strict and apply to every CLI command, API call, and
subagent prompt:

1. **User named specific server(s)** — use those and only those. Pass
   `--server-id <id>` (CLI) or the matching server-id to
   `get-platform-credentials.sh` (REST). Do not touch any other configured
   server.
2. **User did not name a server** — use the current default server and only
   it. Determine the default via `jf config show` (the entry marked as
   default). If no default is set, stop and ask the user which server to use.
3. **Verify before executing** — after resolving the server, confirm it
   exists in `jf config show` output before running any command against it.
   If the server-id is not listed, stop and tell the user.

Do not fall back to a different server. Silently switching servers is
dangerous because different servers hold different data, permissions, and
configurations — an operation that succeeds on the wrong server can corrupt
state, leak data across environments, or produce results the user cannot
reproduce. If the resolved server produces any error — does not exist in
`jf config`, authentication failure (401/403), network error, connection
refused, or any other failure — stop immediately and report the error to the
user. Do not try other configured servers, do not iterate through the server
list, and do not silently switch servers. Ask the user how to proceed.

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

## Artifactory operations

Artifactory resources are managed through the `jf rt` namespace — repos, files,
builds, permissions, users/groups, and replication. Read
`references/artifactory-operations.md` when performing any of these operations.

## Platform administration

Access tokens, login, stats, projects, and system health. Read
`references/platform-admin-operations.md` when performing any of these
operations.

## Falling back to REST APIs

When the CLI does not support an operation, use REST APIs. All commands in this
section require `required_permissions: ["full_network"]` (see Network
permissions above). Read `references/jfrog-credential-patterns.md` for detailed
patterns.

### Tier 1: Artifactory (`jf rt curl`)

Handles authentication automatically:
```bash
jf rt curl -XGET /api/repositories
jf rt curl -XGET "/api/storage/<repo>/<path>?properties"
jf rt curl -XPOST /api/search/aql -H "Content-Type: text/plain" -d '<aql-query>'
```

### Tier 2: Xray (`jf xr curl`)

Handles authentication automatically:
```bash
jf xr curl -XGET /api/v2/watches
jf xr curl -XGET /api/v2/policies
```

### Tier 3: Other products (plain curl)

Extract credentials using the helper script:
```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh [server-id])"
curl -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/access/api/v2/users/"
```

### GraphQL (OneModel)

OneModel is the unified GraphQL API on the platform base URL. **Do not** embed
the query string inside a JSON literal (`-d '{"query":"..."}'`) — GraphQL uses
many double quotes and manual escaping breaks requests. Use **`jq -n --arg`**
to build the payload, and **save the HTTP response to a file** with `curl -o`
before running `jq` (same principle as *Preserving command output* below).

```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh [server-id])"
QUERY='{ evidence { searchEvidence(first: 5, where: { hasSubjectWith: { repositoryKey: "my-repo-local" } } }) { totalCount } } }'
PAYLOAD=$(jq -n --arg q "$QUERY" '{"query": $q}')
RESPONSE_FILE="/tmp/onemodel-$$.json"
curl -s -X POST "$JFROG_URL/onemodel/api/v1/graphql" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  -o "$RESPONSE_FILE"
jq . "$RESPONSE_FILE"
echo "$RESPONSE_FILE"
```

Schema discovery: `GET $JFROG_URL/onemodel/api/v1/supergraph/schema` (schema file
only under `<skill_path>/local-cache/` per `references/onemodel-graphql.md` and
**`local-cache/` — allowed files only** above — not for query responses).

Read **`references/onemodel-graphql.md`** for the full workflow (mandatory schema
fetch, validation, pagination, errors, playground). Read
**`references/onemodel-query-examples.md`** for domain-specific query shapes and
**`references/onemodel-common-patterns.md`** for pagination, variables, and dates.

## Structured inputs

Several CLI commands require JSON template files. The templates are normally
created by interactive wizard commands (`jf rt rpt`, `jf rt ptt`, `jf rt rplt`)
which agents cannot use. Instead, retrieve an existing config via REST API as a
starting point and modify it:

```bash
jf rt curl -XGET /api/repositories/<repo-key>
```

For other Artifactory or platform REST patterns, or when you need more than
this repo GET, see **Any API gap** under [When to read reference files](#when-to-read-reference-files).

## Gotchas

- JFrog network calls require `required_permissions: ["full_network"]` in the
  Shell tool. Without it, commands fail silently with empty output. The
  environment check does **not** call your JFrog server (it may contact
  `releases.jfrog.io` for version checking), but it may need **workspace
  write** access for its cache file (see [Agent execution environments](#agent-execution-environments)).
- `jf rt curl` only works for Artifactory. `jf xr curl` only works for Xray.
  For other products, use plain curl with extracted credentials.
- Remote repository content is stored in a `-cache` suffixed repo. Properties
  and AQL queries for remote repo artifacts must target the cache repo.
  Conversely, `/api/repositories/<key>` only accepts the parent remote key
  (without `-cache`) — strip the suffix for configuration lookups.
- **Do not use `jf rt search`** — always use a direct AQL query via
  `jf rt curl -XPOST /api/search/aql`. See `references/artifactory-aql-syntax.md`.
- Use `--quiet` flag for non-interactive execution (suppresses confirmation
  prompts). **Caution:** `--quiet` is not a global flag — commands that do not
  support it (e.g. `jf rt s`, `jf rt curl`, `jf rt ping`) will fail with
  misleading errors like "Wrong number of arguments" or "flag provided but not
  defined". Check `--help` for a command before adding `--quiet`.
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
- Always use `jf rt curl -s` (silent flag) when piping output to `jq` or
  redirecting to a file. Without `-s`, curl's progress meter is mixed into
  stdout and breaks JSON parsing.
- Build info lookups require a scope (`?buildRepo=` or `?project=`) —
  resolve it before calling the API. See `references/artifactory-operations.md`
  §Retrieving build info for the full workflow.
- If a REST API call returns 401, the access token may have expired —
  re-extract credentials with `get-platform-credentials.sh` for the **same**
  server. If 403, the token lacks required permissions. If 404, verify the
  endpoint path and target server version. On any of these errors, do not
  try a different configured server as a workaround — that targets a
  different environment. Report the error and ask the user.
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

## Cautious execution

Do not run commands speculatively. Before executing any JFrog CLI command or
API call:

1. Confirm the operation is needed to fulfill the user's request
2. Resolve the target server using the **Server selection rules** above —
   there must be no ambiguity about which server is used
3. For mutating operations (create, update, delete, upload), confirm with the
   user unless the intent is clearly implied
4. Prefer read operations first to understand current state before making changes
5. If any command fails with a server-level error (not found, auth, network),
   stop and ask the user — never retry against a different server

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
jf rt curl -XGET /api/repositories > "$OUT"
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
of re-running the same `jf rt curl`, `jf xr curl`, Tier 3 `curl`, or other
identical network-backed command.

Do **not** reuse saved output across unrelated steps or changed contexts (different
server, user, or intent). The file is only valid for the immediate sequence of
operations that motivated the original call.

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
- **Repo, file, build, permission, user/group, or replication operations**: read `references/artifactory-operations.md` (for **listing builds** with a known project key: REST `GET /api/build?project=`, then `GET /api/build/<name>?project=` — see § *Listing builds when the project key is known*)
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

- **Public or custom catalog, package metadata, vulnerability advisories, licenses, OpenSSF, or MCP services (concepts)**: read `references/catalog-entities.md` (~190 lines)
- **CVE details, vulnerability lookup by CVE ID, or severity/affected-packages/fix-versions for a specific CVE**: go directly to `references/onemodel-query-examples.md` § *Public security domain* for the `searchVulnerabilities` query shape — this is self-contained; do not load the `jfrog-package-safety-and-download` skill for pure CVE lookups

### OneModel (GraphQL)

- **GraphQL queries** (applications, packages, evidence, release bundles, catalog, cross-domain, or "list/search my" platform entities): read `references/onemodel-graphql.md` (~325 lines)
- **Query templates and domain-specific examples**: read `references/onemodel-query-examples.md` (~555 lines)
- **Pagination, filtering, GraphQL variables, or date formatting**: read `references/onemodel-common-patterns.md` (~280 lines)

### Platform administration

- **Platform structure, project/repo membership, or project roles vs environments (concepts)**: read `references/platform-access-entities.md`
- **Access tokens, stats, projects, or system health**: read `references/platform-admin-operations.md`
- **Managing JFrog Projects, members, or environments**: read `references/projects-api.md` (~260 lines)
- **Platform REST beyond the CLI, or any platform-level API gap**: read `references/platform-admin-api-gaps.md` (~180 lines)
- **Credential extraction for products beyond Artifactory and Xray**: read `references/jfrog-credential-patterns.md` (~155 lines; includes **Response handling** for any network-backed response body: fetch once to a temp file, then `jq` the file — plain `curl` or `jf rt curl` / `jf xr curl` alike)

### CLI setup & authentication

- **Adding a server or logging in**: read `references/jfrog-login-flow.md` (~130 lines)
- **CLI not installed, upgrade needed, or `jq` unavailable**: read `references/jfrog-cli-install-upgrade.md`

### General patterns

- **Batching, parallel Shell calls, or launching subagents**: read `references/general-parallel-execution.md` (~135 lines)
- **Large or parallel data gathering, list-vs-detail APIs, sandbox/cache issues**: read `references/general-bulk-operations-and-agent-patterns.md`
- **Standalone HTML report with JFrog-aligned styling**: read `references/jfrog-brand-html-report.md`
- **Reusable gotchas from past tasks**: read or extend `references/general-use-case-hints.md`
