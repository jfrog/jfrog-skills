# Skills Architecture

This document describes the architecture of the JFrog skills — how they are organized, how the base `jfrog` skill is structured internally, and how workflow skills extend it.

## Layered skill architecture

Skills live in a **flat directory structure** (`skills/<name>/`) but are logically organized into two layers: one base skill and N workflow skills. Layering is expressed through SKILL.md metadata (`role: base` vs `role: workflow`) and prerequisite declarations, not directory nesting.

```mermaid
flowchart TD
    subgraph base ["Base Skill"]
        JF["jfrog<br/><i>foundation + routing</i>"]
    end

    subgraph workflows ["Workflow Skills"]
        PS["jfrog-package-safety-and-download"]
        RA["jfrog-reference-architecture"]
        SPM["jfrog-setup-package-managers"]
        Future["...future workflow skills"]
    end

    JF -->|"routes to"| PS
    JF -->|"routes to"| RA
    JF -->|"routes to"| SPM
    JF -.->|"future"| Future
    PS -.->|"prereq"| JF
    RA -.->|"prereq"| JF
    SPM -.->|"prereq"| JF
```

**Base skill (`jfrog`)** — the single foundational skill. Covers platform concepts, CLI setup and authentication, REST/GraphQL API patterns, and intent routing to workflow skills. Every other skill declares it as a prerequisite.

**Workflow skills** — domain-specific skills that handle a focused category of operations. Each declares `jfrog` as a prerequisite so the agent loads foundational context first.

**Adding a new skill:** create `skills/jfrog-<name>/SKILL.md` with `metadata.role: workflow` and a `Prerequisites` section pointing to `../jfrog/SKILL.md`. Update the base skill's routing section to reference the new workflow.

### Workflow skill: `jfrog-reference-architecture`

Planning skill for topology, sizing (RPM / t-shirt templates), deployment patterns, and documented use cases. It does **not** duplicate reference-architecture content in the repo.

**Content access:** agents `WebFetch` [llms-full.txt](https://jfrog.com/reference-architecture/llms-full.txt) at session start (~120 KB today), parse sections by `URL:` headers, and cite those HTML links. Fallbacks: [llms.txt](https://jfrog.com/reference-architecture/llms.txt), [sitemap.xml](https://jfrog.com/reference-architecture/sitemap.xml), per-page `index.md`. Size governance and the fetch ladder live in `skills/jfrog-reference-architecture/references/doc-access.md`.

**Deployment policy:** prefer Kubernetes and the [jfrog-platform](https://github.com/jfrog/charts/tree/master/stable/jfrog-platform) Helm chart even for Artifactory-only installs.

No `jf` CLI is required for planning-only questions.

### Workflow skill: `jfrog-setup-package-managers`

Binds local package managers (npm, pip, maven, gradle, go, docker, helm, nuget, …) to Artifactory repositories via `jf setup`, then records the decision in the workspace binding file `.jfrog/local/package-resolution.json`. It does not discover repos on its own — it uses the repo keys resolved by the Package Resolution session hook. Reference details live in `skills/jfrog-setup-package-managers/references/`.

---

## Base skill: `jfrog` — internal architecture

The base skill is large. **Reference files** use progressive disclosure (load via
`INDEX.md` only what the task needs). The **SKILL.md body** is ordered for
**primacy + recency** so partial readers (first-chunk skimmers) still see
invariants — not to discourage full reads by capable models.

### Entry point: SKILL.md

`skills/jfrog/SKILL.md` is the entry point. Top **At a glance** (invariants +
contents map) + tail **Before you run `jf` checklist**. Prefer full-file read;
At a glance is the floor for partial readers. Domain refs → on-demand via
`references/INDEX.md`.

| Section | Purpose |
|---------|---------|
| **At a glance (always-read core)** | Primacy floor for partial readers: UA; `--server-id` after subcommand (network; bootstrap exempt); one server / stop-don't-switch (+ compare if user names); no prep mutations unless asked; never guess paths; **never skip** Cautious execution / Server selection / the Tier A Gotchas floor. Full `cli-gotchas.md` is Tier B — required only on `jf api` / advanced CLI paths |
| **Prerequisites** | Required tools (`jq`); per-runtime network and filesystem permission table (Cursor / Claude Code / Other) — replaces the old standalone "Network permissions" section |
| **Tool selection strategy** | Three-tier routing: JFrog MCP tools (preferred), `jf` CLI commands (fallback), `jf api` (last resort). Defines when to move to the next tier and how to handle cross-tier permission errors |
| **Environment check** | Cached CLI detection via `scripts/check-environment.sh <model-slug>`; script prints the user-agent value on stdout following RFC 7231 product/comment grammar — `jfrog-skills/<v> (trigger=skill; tool=<harness>; client=<app>; model=<slug>) jfrog-cli-go/<v>` — where the parens carry semicolon-separated `key=value` annotations (`trigger=skill` always on this path; `tool=`/`client=`/`model=` when known; harness from `detect_harness()`, `client` from `TERM_PROGRAM`) for the agent to remember and `export JFROG_CLI_USER_AGENT='<value>'` (plus `export JFROG_CLI_AI_MODEL='<slug>'`) once at the top of every bash invocation that runs `jf`. APR `jfrog-agent-hooks` eager setup overrides the same grammar with `trigger=hook` when it spawns `jf`. `tool=` is always emitted when known — mcp-management Step A parses this stdout line, which never includes the CLI's `ai-agent/` token. On jf >= 2.120.0 the CLI appends `ai-agent/` / `ai-client/` / `ai-model/` itself, so the script omits `client=` to avoid double-encoding; exit-code contract (MCP Tier 1 can proceed without this check; exit 2/3 means CLI tiers are unavailable). Supported harnesses: see **Agent identity table** below. |
| **`~/.jfrog/skills-cache/` — allowed files only** | Restricts the cache to two artifacts; routes everything else to `/tmp` |
| **Cautious execution** | Confirm-before-mutate (all tiers), ask-on-ambiguity, never invent preparatory mutations, never guess tool names or API paths (anti-hallucination rule) |
| **Server selection rules (mandatory)** | Single-server resolution; `awk` one-liner for the default server; no silent fallback; MCP/CLI auth independence warning; standard error-response template |
| **Path-gated base references (Tier B)** | Four files extracted from SKILL.md — `cli-gotchas`, `jf-api`, `preserving-command-output`, `cli-command-discovery` — **MUST full reads before `jf api` / advanced CLI**, not before every CLI/setup; not domain on-demand |
| **When to read reference files** | Tier A = At-a-glance floor; Tier B = path-gated base refs; Tier C = domain via `references/INDEX.md` (≤2–3). Contract test enforces INDEX ↔ files sync |
| **Command discovery** | `--help` ladder; Tier B **MUST** `references/cli-command-discovery.md` when needed |
| **Invoking platform APIs with `jf api`** | Tier 3 pointer; Tier B **MUST** `references/jf-api.md` |
| **Structured inputs** | REST GET as template instead of interactive wizards |
| **Gotchas — hard rules (never skip)** | Tier A floor in SKILL.md At-a-glance / Gotchas; full `references/cli-gotchas.md` is Tier B before `jf api` / advanced CLI. Not tips; short bullets do not replace the file on Tier B paths |
| **Batch and parallel execution** | Three-tier pointer → `references/general-parallel-execution.md` |
| **Preserving command output** | Short rule in SKILL.md; Tier B **MUST** `references/preserving-command-output.md` |
| **Before you run `jf` — quick checklist** | Recency = Tier A At-a-glance + Tier B only when next action needs `jf api` / advanced CLI |

Authoring: `instruction-patterns.md` → Primacy / recency; rule: `skill-validation.mdc`.

### Agent identity table

Identity axes on the wire (CLI User-Agent / Call-Home / Visibility):

| Axis | Wire (CLI ≥ 2.120) | Skill/hook parens | Source |
|------|--------------------|-------------------|--------|
| Trigger | *(parens only)* | `trigger=skill` / `trigger=hook` | Skills `check-environment.sh` vs APR eager-setup spawn |
| Agent | `ai-agent/<name>` | `tool=<name>` (older CLI / skill carrier) | Env detectors below, else `AI_AGENT` / `AGENT` |
| Client | `ai-client/<app>` | `client=<app>` (older CLI / skill carrier) | Sanitized `TERM_PROGRAM` (any host; not an allowlist) |
| Model | `ai-model/<slug>` | `model=<slug>` | Sanitized `JFROG_CLI_AI_MODEL` / skill arg |

`trigger` is skill-layer attribution (not a CLI product token). Direct human `jf` without skills/hooks leaves it unset.

`detect_harness()` first-match order matches `agentEnvDetectors` in jfrog-cli-core `common/commands/execution_context.go`. Claude and Cursor also accept the v0.22.0 product envs (`CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT`, `CURSOR_CLI` / `CURSOR_TRACE_ID`) so mcp-management can route Agent Guard. Those envs are set for humans in the IDE terminal too; real agent skill usage is `model=` (or `ai-model/`).

**CLI release pin:** companions [jfrog-cli-core#1602](https://github.com/jfrog/jfrog-cli-core/pull/1602) + [jfrog-cli#3645](https://github.com/jfrog/jfrog-cli/pull/3645) are merged, but tip still reports `CliVersion = 2.119.0`. Released 2.118/2.119 only appended `ai-agent/`. Skills omit parens `client=` at `AGENT_UA_MIN_CLI_VERSION` (expected first full Client→Agent→Model release **2.120.0**) and always emit `tool=` when known. After that CLI release cuts, confirm the tag and update the constant if the version number differs.

| Wire name | Session signals |
|-----------|-----------------|
| `claude` | `CLAUDE_CODE_CHILD_SESSION`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` |
| `gemini` | `GEMINI_CLI` |
| `goose` | `GOOSE_TERMINAL` |
| `cursor` | `CURSOR_AGENT`, `CURSOR_EXTENSION_HOST_ROLE=agent-exec`, `CURSOR_CLI`, `CURSOR_TRACE_ID` |
| `copilot` | `COPILOT_CLI`, `COPILOT_AGENT_SESSION_ID` |
| `kilocode` | `KILOCODE_FEATURE`, `KILO_PID` |
| `roo_code` | `ROO_ACTIVE`, `ROO_CLI_RUNTIME` |
| `codex` | `CODEX_CI`, `CODEX_THREAD_ID`, `CODEX_SANDBOX` |
| `windsurf` | `WINDSURF_CASCADE_TERMINAL` |
| `aider` | `AI_AGENT` / `AGENT` only |
| `cline` | `CLINE_ACTIVE` |
| `opencode` | `OPENCODE`, `OPENCODE_SESSION_ID` |
| `amp` | `AMP_CURRENT_THREAD_ID` |
| `augment` | `AUGMENT_AGENT` |
| `qwen` | `QWEN_CODE` |
| `antigravity` | `ANTIGRAVITY_AGENT` |
| `crush` | `CRUSH` |
| `iflow` | `IFLOW_CLI` |
| `trae` | `TRAE_AI_SHELL_ID` |
| `amazon_q` | `AI_AGENT` / `AGENT` only |
| `unknown` | `AI_AGENT` / `AGENT` set to an unrecognized value |

Common `AI_AGENT` / `AGENT` aliases: `claude-code`→`claude`, `gemini-cli`→`gemini`, `cursor-cli`→`cursor`, `github-copilot`/`copilot-cli`→`copilot`, `roo-code`→`roo_code`, `amazon-q`/`amazon-q-cli`→`amazon_q`, `qwen-code`→`qwen`. Version suffixes (`goose@1.2.3`) are stripped.

### Reference files

`references/INDEX.md` is the routing index for everything below: `SKILL.md`'s `When to read reference files` section links to it, and it maps task categories to the specific files in the five categories that follow. It must list every `references/*.md` file (itself excepted); `tests/jfrog/test_reference_index_contract.py` fails CI if the index and the actual files diverge, so a new reference file cannot ship unrouted. The same test also locks the MUST-tier model — Tier A always-read floor, Tier B path-gated refs (before `jf api` / advanced CLI), Tier C on-demand — so wording cannot regress to claiming the four base refs are mandatory before every CLI or that setup requires a full base `SKILL.md` read.

The `references/` directory contains markdown files organized into five categories:

#### Domain model (entity definitions and relationships)

These files define what JFrog entities are, their relationships, and their access patterns. The entity index is the starting point for cross-product disambiguation.

| File | Domain |
|------|--------|
| `jfrog-entity-index.md` | Cross-product |
| `artifactory-entities.md` | Artifactory |
| `xray-entities.md` | Xray |
| `release-lifecycle-entities.md` | Release Lifecycle |
| `apptrust-entities.md` | AppTrust |
| `catalog-entities.md` | Catalog |
| `stored-packages-entities.md` | Stored Packages |
| `platform-access-entities.md` | Platform / Access |

```mermaid
flowchart LR
    Index["jfrog-entity-index.md<br/><i>cross-product map</i>"]

    Index --> ArtE["artifactory-entities.md"]
    Index --> XrayE["xray-entities.md"]
    Index --> RLE["release-lifecycle-entities.md"]
    Index --> AppE["apptrust-entities.md"]
    Index --> CatE["catalog-entities.md"]
    Index --> SPE["stored-packages-entities.md"]
    Index --> PlatE["platform-access-entities.md"]
```

#### Operations (CLI commands and API patterns)

These files tell the agent *how* to perform specific operations.

| File | Scope |
|------|-------|
| `artifactory-operations.md` | `jf rt` commands, build scope discovery, AQL workflows (AQL executed via `jf api`) |
| `platform-admin-operations.md` | Tokens, stats, projects, system health |
| `artifactory-aql-syntax.md` | AQL domains, criteria, query construction |
| `projects-api.md` | Access API for JFrog Projects (via `jf api`) |

#### OneModel (GraphQL)

The OneModel GraphQL API has its own family of references because the query
surface, schema cache, and pagination model differ from the REST endpoints
above. The schema is cached per-server under `~/.jfrog/skills-cache/onemodel-schema-<server-id>.graphql`.

| File | Scope |
|------|-------|
| `onemodel-graphql.md` | GraphQL endpoint overview, schema-discovery flow, query catalog |
| `onemodel-query-examples.md` | Domain-specific query templates (applications, packages, evidence, release bundles, catalog, public security / CVE lookups) |
| `onemodel-common-patterns.md` | Pagination, filtering, GraphQL variables, date formatting |

#### API gaps (REST-only operations)

When the CLI does not cover an operation, these files document the REST API fallback.

| File | Scope |
|------|-------|
| `artifactory-api-gaps.md` | REST-only Artifactory operations |
| `platform-admin-api-gaps.md` | Access/admin REST endpoints |

#### Infrastructure and patterns

Cross-cutting concerns — authentication, credential management, parallelism, bulk operations, and styling.

| File | Purpose |
|------|---------|
| `jfrog-login-flow.md` | Web login security rules, session scripts |
| `jfrog-cli-install-upgrade.md` | Install/upgrade procedures for `jf` |
| `jfrog-url-references.md` | docs.jfrog.com link catalog |
| `jfrog-brand-html-report.md` | HTML report styling |
| `general-parallel-execution.md` | Three-tier parallelism: shell batch, parallel tool calls, subagents |
| `general-bulk-operations-and-agent-patterns.md` | List-vs-detail, N+1, timeouts, NDJSON, concurrency |
| `general-use-case-hints.md` | Living table of edge cases and mitigations |

### Scripts

Helper scripts in `scripts/` handle environment bootstrapping and credential management:

| Script | Purpose | When called |
|--------|---------|-------------|
| `check-environment.sh` | Verifies `jf` CLI is installed and current; caches result for 24h | First JFrog operation in a session |
| `jfrog-login-register-session.sh` | Registers a browser login session; outputs `SESSION_UUID` and `VERIFY_CODE` | Adding a new server via web login |
| `jfrog-login-save-credentials.sh` | Retrieves token from completed login session and runs `jf config add`; verifies with `jf api /artifactory/api/system/version` | Completing a web login flow |

### Skill cache (`~/.jfrog/skills-cache/`)

The runtime cache lives outside the installed skill tree, at
`${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}/skills-cache/` — co-located with
`jf config`. This keeps the skill itself read-only-installable. The directory
holds **only**:

- **`jfrog-skill-state.json`** — output of `check-environment.sh`
- **`onemodel-schema-<server-id>.graphql`** — cached OneModel supergraph per configured CLI server

Agents must **not** store HTTP responses, GraphQL results, or other scratch files there; use `/tmp` (or `mktemp`) per the base skill's SKILL.md.

---

## Tool selection: JFrog MCP, CLI, `jf api`

The base skill uses a three-tier tool selection strategy. **JFrog MCP** tools
are the preferred tier when available. When a JFrog MCP tool does not exist
for the operation or fails, the agent falls back to dedicated `jf` CLI
subcommands. When neither covers the operation, `jf api` is the last resort. `jf api` replaces the previous `jf rt curl` / `jf xr curl` /
plain `curl` model and gives the agent one authentication mechanism, one
invocation pattern, and one exit-code contract across every JFrog product.

```
┌─────────────────────────────────────────────────────────────┐
│  jf api /<product>/api/...                                  │
│                                                             │
│  Product prefix decides the target service:                 │
│    /artifactory/api/...   — Artifactory                     │
│    /xray/api/...          — Xray + Curation                 │
│    /access/api/...        — Access, users, projects, tokens │
│    /evidence/api/...      — Evidence                        │
│    /apptrust/api/...      — AppTrust                        │
│    /distribution/api/...  — Distribution                    │
│    /lifecycle/api/...     — Release Lifecycle               │
│    /onemodel/api/v1/graphql — OneModel GraphQL              │
│                                                             │
│  Authentication: the active `jf config` server (or          │
│  --server-id=<id>). No token extraction, no Authorization   │
│  headers, no JFROG_ACCESS_TOKEN env var.                    │
└─────────────────────────────────────────────────────────────┘
```

Binary artifact content (downloads, uploads) still goes through the native
CLI commands — `jf rt dl`, `jf rt u`, `jf rt cp`, etc. — which are
**kept** because they are not thin HTTP wrappers; they implement
multipart, checksum, and redirect-follow behaviour `jf api` does not.

---

## Progressive disclosure model

The skill is designed so agents load context incrementally rather than reading everything upfront:

```
Agent receives user request
    │
    ├─ Read SKILL.md (always — entry point)
    │
    ├─ Try JFrog MCP tool (Tier 1 — no env check needed)
    │   └─ If a JFrog MCP tool exists and succeeds → done
    │
    ├─ Run check-environment.sh (first CLI/API operation only)
    │
    ├─ Match task to the routing index in references/INDEX.md
    │   (via the "When to read reference files" pointer in SKILL.md)
    │   │
    │   ├─ Entity disambiguation? → jfrog-entity-index.md → domain file
    │   ├─ Artifactory operation? → artifactory-operations.md
    │   ├─ AQL query?            → artifactory-aql-syntax.md
    │   ├─ Platform admin?       → platform-admin-operations.md
    │   ├─ OneModel GraphQL?     → onemodel-graphql.md (+ ...)
    │   ├─ API gap?              → artifactory-api-gaps.md / platform-admin-api-gaps.md
    │   ├─ Login needed?         → jfrog-login-flow.md
    │   ├─ Bulk/parallel?        → general-parallel-execution.md
    │   └─ ... (2-3 files max per operation)
    │
    └─ Execute via CLI (Tier 2) or jf api (Tier 3)
```

This keeps the agent's context window focused. Most operations require reading SKILL.md plus 1–3 reference files.
