# Reference index — when to read which file

**Tier A** = `SKILL.md` At-a-glance floor (before first non-exempt `jf`).
**Tier B** = four files below — **MUST** before `jf api` / AQL / advanced CLI
I/O / MCP-via-shell; **not** before every CLI or `jf setup`.
**Tier C** = domain entries — ≤2–3 most specific; skip unused. Login / CLI
install when needed.

Paths relative to skill root. List **every** `references/` file (except this
one). CI: `tests/jfrog/test_reference_index_contract.py`.

---

## Tier B — path-gated (MUST before `jf api` / advanced CLI)

Ordinary CLI / `jf setup` → Tier A only. Skipping any below on a Tier B path =
hard-rule violation.

- **Gotchas / caveats / do-don'ts**: **MUST** `references/cli-gotchas.md` on Tier B — not replaceable by SKILL.md Tier A floor
- **`jf api` prefixes / flags / GraphQL**: **MUST** `references/jf-api.md` before `jf api`
- **Temp files / `$$` / no re-fetch**: **MUST** `references/preserving-command-output.md` before advanced I/O
- **Namespaces / top-level cmds / Pipelines sunset**: **MUST** `references/cli-command-discovery.md` when discovery beyond `--help`

Tier C (when needed — not Tier B):

- **Login / add server**: `references/jfrog-login-flow.md`
- **CLI install / upgrade / `jq` missing**: `references/jfrog-cli-install-upgrade.md`

---

## Domain / on-demand (INDEX navigation)

Load the most specific file for the task. Avoid more than 2–3 reference files
for one operation.

## Cross-domain

- **Disambiguating a JFrog entity, understanding entity types, or planning operations that span multiple products**: read `references/jfrog-entity-index.md`, then follow pointers to the relevant domain file
- **Looking up documentation URLs**: read `references/jfrog-url-references.md`

## Artifactory

- **Repository types, artifacts, builds, properties, or permission targets (concepts)**: read `references/artifactory-entities.md`
- **Stored packages, package versions, version locations, or the metadata layer over Artifactory (concepts)**: read `references/stored-packages-entities.md`
- **Repo, file, build, permission, user/group, or replication operations**: if the JFrog MCP server exposes a tool for the operation, prefer it. For CLI/API fallback, read `references/artifactory-operations.md` (for **listing builds** use AQL with `limit`/`offset` — see § *Listing build names*; for **full build detail** use `GET /api/build/<name>/<number>?project=` — see § *Retrieving full build info*)
- **AQL queries**: read `references/artifactory-aql-syntax.md`
- **Artifactory REST beyond the CLI, structured JSON templates (replacing interactive wizards), or any Artifactory API gap**: read `references/artifactory-api-gaps.md`

## Xray & security

- **Watches, policies, violations, components, or vulnerability scanning (concepts)**: read `references/xray-entities.md`
- **Exposures scanning results (secrets, IaC, service misconfigurations, application security risks)**: read `references/xray-entities.md` § Exposures (Advanced Security)
- **Curation audit events (approved/blocked packages, dry-run policy evaluations, curation export)**: read `references/xray-entities.md` § Curation audit events

## Release lifecycle & distribution

- **Release bundles, lifecycle stages, distribution, or evidence (concepts)**: read `references/release-lifecycle-entities.md`
- **Applications, application versions, releasables, promotions, or AppTrust (concepts)**: read `references/apptrust-entities.md`

## Catalog

- **Public or custom catalog, package metadata, vulnerability advisories, licenses, OpenSSF, or MCP services (concepts)**: if the JFrog MCP server exposes a catalog tool, prefer it for single-package lookups. For deeper queries, read `references/catalog-entities.md`
- **CVE details, vulnerability lookup by CVE ID, or severity/affected-packages/fix-versions for a specific CVE**: prefer an MCP vulnerability-lookup tool if the JFrog MCP server exposes one. Otherwise read `references/onemodel-query-examples.md` § *Public security domain* for the `searchVulnerabilities` query shape — this is self-contained; do not load the `jfrog-package-safety-and-download` skill for pure CVE lookups

## OneModel (GraphQL)

- **GraphQL queries** (applications, packages, evidence, release bundles, catalog, cross-domain, or "list/search my" platform entities): read `references/onemodel-graphql.md`
- **Query templates and domain-specific examples**: read `references/onemodel-query-examples.md`
- **Pagination, filtering, GraphQL variables, or date formatting**: read `references/onemodel-common-patterns.md`

## Platform administration

- **Platform structure, project/repo membership, or project roles vs environments (concepts)**: read `references/platform-access-entities.md`
- **Access tokens, stats, projects, or system health**: read `references/platform-admin-operations.md`
- **Managing JFrog Projects, members, or environments**: read `references/projects-api.md`
- **Platform REST beyond the CLI, or any platform-level API gap**: read `references/platform-admin-api-gaps.md`

## General patterns

- **Batching, parallel Shell calls, or launching subagents**: read `references/general-parallel-execution.md`
- **Large or parallel data gathering, list-vs-detail APIs, cache hygiene**: read `references/general-bulk-operations-and-agent-patterns.md`
- **Standalone HTML report with JFrog-aligned styling**: read `references/jfrog-brand-html-report.md`
- **Reusable gotchas from past tasks**: read or extend `references/general-use-case-hints.md`
