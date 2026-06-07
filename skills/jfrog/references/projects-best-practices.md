# JFrog Projects best practices

Doctrine for the
[`jfrog-project-setup`](../../jfrog-project-setup/SKILL.md) workflow
skill (Phase 1+2 creation and Phase 3+4 repository structure +
sharing). Endpoint shapes live in
[`projects-api.md`](projects-api.md) and
[`oidc-integration.md`](oidc-integration.md); the per-resource state
machine lives in
[`projects-verification-contract.md`](projects-verification-contract.md).

## Why projects exist

Projects bundle repositories, builds, release bundles, members,
roles, and environments under one logical entity (team,
application, GitHub org) so platform teams can delegate authority
without becoming a bottleneck. Create one when a team needs
isolated resources, delegated day-to-day setup, or per-business-unit
reporting. Do **not** create one for ad-hoc shared infrastructure
(golden images, public mirrors) — those belong in a "shared
services" project or at platform level.

## Defining the project entity

### Project scope

Default: **Team = Project** (one project per team's workspace; one
virtual repo URL per tech; permission management once per team).
Alternatives that work in practice:

- **Application = Project** — when the application has a stable
  funding/budget identity.
- **Budget ID = Project** — survives team restructuring.
- **External org = Project** — mirrors GitHub/GitLab org structure.

Avoid "one project per repo" (too granular) and "one project for
everyone" (defeats isolation).

### Project key

The project key is **immutable** and is used as a prefix on every
repository created inside the project. Constraints (also enforced by
the apply script):

- 2–32 characters, lowercase alphanumeric and hyphens.
- Must start with a letter; no leading or trailing hyphen.

Pick a stable identifier (team name, budget ID, app catalog ID) and
stick with it. If the proposed key violates the rules, surface the
violation and ask for a corrected key — never silently mangle it.

### Storage quota

Default is Unlimited. Set a quota at creation time so a single team
cannot exhaust shared storage — JFrog warns at 75% and errors at
100% (deployments may be blocked). Quota is measured against total
virtual size, set in GB, and editable later.

### Admin privileges

Three flags on `admin_privileges`:

- `manage_members` — add/remove users and groups in this project.
  **On** for delegated-admin archetypes; **off** when a central
  platform team owns membership.
- `manage_resources` — create/update/delete repos, builds, release
  bundles. **On** for "Team = Project"; **off** when the platform
  team exclusively provisions infrastructure.
- `index_resources` — mark repos, builds, and release bundles for
  Xray indexing. **On** if the project uses Xray.

Newer Artifactory versions (7.146.0+) split create/update/delete
permissions on remote vs. local vs. virtual repositories — check
the current platform version before locking a privilege model.

## Identity and access strategy

Project-based RBAC replaces global permission targets. Three role
tiers are relevant (see
[Project Roles and Members Concepts](https://docs.jfrog.com/projects/docs/project-roles-and-members-concepts)):

- **Platform roles** — apply across the whole platform; Platform
  Admin is the canonical example.
- **Global roles** — defined platform-wide but assignable inside a
  project. Useful for shared role definitions ("Developer",
  "Release Manager") that every project should have.
- **Project roles** — defined inside a single project, scoped by
  environment (DEV, PROD, etc.) and bound to specific actions.

### RBAC by environment, not by repository

Map roles to **environments/stages** rather than individual
repositories. As an artifact moves DEV → QA → PROD, access changes
automatically based on which environment hosts it. New members
inherit the right access by being assigned a role; nobody edits
per-repo permissions.

### Group-first membership

Always model project membership — including the Project Admin role
— as **groups with roles**, not as users with roles. Group-based
membership maps cleanly to IdP groups synced via SAML/SCIM/LDAP,
survives team rotation, and reduces audit surface area. The
`PUT /projects/<key>/users/<u>` endpoint exists as a last resort for
service accounts that cannot belong to a group. Platform Admins are
tagged `Admin` automatically and need no explicit project-level role.

### Predefined roles

Use predefined roles when they fit (see
[`projects-api.md`](projects-api.md) for full definitions):
**Project Admin** (full control), **Developer** (read/write/annotate
repos, read builds), **Contributor** (narrower stage write),
**Viewer** (read-only), **Release Manager** (promote/distribute,
PROD-scoped), **Security Manager** (Xray watches, policies),
**AppTrust Manager** / **Model Governor** / **Model Developer**
(domain-specific).

Define a custom role only when no predefined role matches.
Custom-role definitions differ across projects, so multi-project
reports must fetch roles **per project** — see
[`platform-access-entities.md`](platform-access-entities.md).

### OIDC for CI authentication

Authenticate CI pipelines with OIDC; static API keys and refresh
tokens stored in CI secrets are an anti-pattern. The split that
matters for project setup: **provider creation is platform-wide**
(one provider serves many projects), but **identity mappings are
provider-scoped and their token-spec scope can be project-specific**
(`applied-permissions/groups:team-x-devs`). See
[`oidc-integration.md`](oidc-integration.md) for endpoints and
per-CI claim recipes.

## Archetypes

One archetype ships as a bundled blueprint at
`skills/jfrog/assets/project-templates/team-default.json` (single
product team, generous default quota, predefined Developer + Release
Manager roles, OIDC optional). Orgs that need a different shape —
delegated-admin for self-service application teams, budget-ID-as-key
for finance-driven naming, enterprise governance with explicit
custom roles — author the variant directly in their Artifactory
templates repo. The agent fetches via the three-tier chain in
[`project-templates-artifactory-repo.md`](project-templates-artifactory-repo.md)
and falls back to the bundled blueprint only when nothing resolves.

## Repository structure

Decisions made here determine how the team consumes packages,
where artifacts are promoted, and how external dependencies enter
the platform.

### Technology scoping (one repo set per package type)

A project rarely uses one package type. The standard pattern is
**one repository set per technology**:

- Maven, npm, PyPI, Docker, Go, NuGet, Helm, Conan, generic, etc.
- Each tech gets its own local/remote/virtual triplet — no
  kitchen-sink repository that mixes types.

Why: package managers expect tech-specific layouts. A `maven`
virtual cannot resolve npm metadata. Mixing also breaks per-tech
storage reporting and curation policies.

### SDLC stages

Stages are the project's **environment list** (in JFrog
terminology) — they are how RBAC is granted and how artifacts are
promoted. Default recommendation:

| Stage      | Purpose                                                              | Typical RBAC                           |
| ---------- | -------------------------------------------------------------------- | -------------------------------------- |
| `DEV`      | Day-to-day development artifacts                                     | Developer: read+write                  |
| `QA`       | Optional. Pre-release validation                                     | Developer: read; Release Manager: r+w  |
| `PROD`     | Releasable, immutable                                                | Developer: read; Release Manager: r+w  |
| `External` | Third-party / upstream packages cached through proxy / remote repos  | Developer: read+write (cache only)     |

Three constraints:

1. **Names are uppercase** by convention (the platform is
   case-sensitive here; mixed case works but breaks parity with
   `jf api` defaults).
2. **`PROD` is mandatory** (it is also the implicit destination for
   release-bundle promotion).
3. **`External` is strongly recommended** even for projects that
   don't plan to use third-party packages today — it is the only
   place where developers should have write access to remote-cached
   content. Adding it later is non-trivial because it is
   intertwined with RBAC.

### Four-part repository naming convention

Every repository inside a project follows:

```
<project_key>-<tech>-<maturity>-<locator>
```

| Part          | Allowed values                                        | Notes                                    |
| ------------- | ----------------------------------------------------- | ---------------------------------------- |
| `project_key` | as defined when creating the project                  | immutable; the prefix every repo carries |
| `tech`        | `maven`, `npm`, `pypi`, `docker`, `go`, `helm`, ...   | lower-case, no version suffixes          |
| `maturity`    | `dev`, `qa`, `prod`, `external`, ...                  | matches a stage, lower-case              |
| `locator`     | `local` \| `remote` \| `virtual`                      | matches Artifactory's repo-type concept  |

**Canonical tech tokens.** Always use these exact lowercase tokens in the
`<tech>` slot — do not substitute synonyms (e.g. `mvn` not `maven`,
`npm` not `node`):

| Package type | Canonical token |
| ------------ | --------------- |
| Apache Maven | `maven` |
| npm / Node.js | `npm` |
| PyPI / Python | `pypi` |
| Docker / OCI | `docker` |
| Go modules | `go` |
| NuGet / .NET | `nuget` |
| Helm | `helm` |
| Conan (C/C++) | `conan` |
| Terraform | `terraform` |
| Generic / other | `generic` |

For package types not listed, use the lowercase Artifactory `packageType`
string (e.g. `cargo`, `composer`, `conda`, `debian`, `rpm`, `cocoapods`).
Using a non-canonical token (e.g. `mvn`, `node`, `python`) causes
inconsistency across sessions and breaks the `--strict-naming` convention
check — the validator normalises against this table.

Examples for `project_key = team-x`:

```
team-x-maven-dev-local
team-x-maven-prod-local
team-x-maven-external-remote
team-x-maven-all-virtual
team-x-npm-dev-local
team-x-docker-prod-local
```

The convention is **doctrine, not API-enforced** — Artifactory will
accept any repo name. Convention violations should:

- Warn (not block) by default — many projects have legacy repos.
- Block (`--strict-naming`) in CI gates and on greenfield projects.

The validator emits the diagnostic `convention_violation: <repo>`
for each mismatch, with a suggested 4-part name.

### Per-tech repository blueprint

For each declared technology: one **local** per stage; exactly one
**remote** on the External stage with the canonical upstream URL
preconfigured (Maven Central, npm registry, PyPI, etc.); one
**virtual** that aggregates them with explicit resolution order.
Developers point their package manager at the virtual and never
touch locals or remotes directly. Always proxy upstream; never let
developers point to ad-hoc remotes.

### Virtual aggregator with explicit resolution order

The virtual is the single resolution endpoint developers touch. The
recommended order is:

```
prod  →  dev  →  external  →  smart-remotes  (if any)
```

`prod` first so released artifacts shadow in-progress versions on
collision; `dev` second so day-to-day work resolves locally;
`external` last among internal repos so an internal artifact always
wins over the same coordinate from a public source (supply-chain
defence); smart-remote consumers trail at the end. The apply script
rewrites `repositories[]` with this explicit order rather than
relying on insertion order.

### External-stage RBAC pattern

This is the rule that makes the External stage useful as a
supply-chain boundary:

| Role             | Internal stages (DEV / QA / PROD) | External stage |
| ---------------- | --------------------------------- | -------------- |
| Developer        | read                              | read + write   |
| Release Manager  | read + write                      | read           |
| Security Manager | read                              | read           |
| Project Admin    | read + write                      | read + write   |

Why developers get write on External: pulling a new public package
the first time triggers a cache write into the remote repo. If
developers have no write here, the cache fails and developers are
blocked. If developers have write on internal stages, they can
bypass the External flow by hand-uploading a malicious package that
masquerades as a dependency. The External stage is the only place
this is acceptable.

## Cross-project sharing

When teams need to consume each other's artifacts, JFrog offers two
patterns. They are not interchangeable; pick per consumer.

### Direct sharing (push)

The producer marks one of its locals (typically the `prod` local)
as **Shared** with one or more consumer projects; the consumer adds
the shared repo directly into its own virtual aggregator's
`repositories[]`. Resolution is live — the consumer always sees the
producer's current state.

- **Producer-controlled lifecycle.** Producer-side deletion or
  revocation removes consumer access immediately.
- **Live resolution.** No caching layer.
- **Best for:** tightly-coupled internal teams.

The exact endpoint shape for the share-with-projects flag has
changed across platform versions — always GET the producer's repo
config first and compute the diff.

### Smart Remote (pull)

The consumer creates a **smart remote** repository pointing at the
producer's URL. Artifactory caches what the consumer pulls; the
consumer's cache is independent of the producer.

- **Consumer-controlled lifecycle.** Producer-side deletion does
  not immediately break the consumer.
- **Cached resolution.** Consumer pays a small storage cost for
  deterministic builds during producer outages.
- **Best for:** stricter segregation, contractual independence, or
  cross-org boundaries.

The smart-remote URL is the producer's repository URL on the JFrog
platform. Authentication uses the consumer's machine identity
(project access token or OIDC mapping) — never the producer's
token.

### Read-only consumer rule

**Regardless of method, the consumer must hold read-only permission
on the producer's assets.** Two enforcement points:

1. The producer's share/grant call should specify only read actions
   for the consumer project. If the producer's call would grant
   write to the consumer, the apply script refuses to apply that
   sharing entry (`error: cross_project_write_forbidden`).
2. The consumer's virtual aggregator references the producer's
   repo, never an alias that would expose write paths.

### Picking between push and pull

| Question                                               | Push (direct) | Pull (smart remote) |
| ------------------------------------------------------ | ------------- | ------------------- |
| Should consumer survive producer outages?              |       no      |        yes          |
| Should consumer always see producer's latest state?    |      yes      |        no           |
| Is the producer's project run by a different org/team? |       no      |        yes          |
| Should consumer pay no extra storage?                  |      yes      |        no           |
| Will the producer's repo be deleted/replaced often?    |       no      |        yes          |

Most internal-platform → internal-team sharing is push. Most
cross-org or cross-cluster sharing is pull.

## Anti-patterns

Entity and access:

- **Project per repository.** Defeats RBAC and inflates project
  count against the subscription allocation.
- **Project key based on the year, version, or release.** Keys are
  immutable; tie them to stable identifiers.
- **Members assigned as users instead of groups.** Creates audit
  drift and manual onboarding cost.
- **Permission targets on individual repos inside a project.** Use
  roles bound to environments instead.

Repository structure:

- **A single `prod` local for all tech.** Defeats per-tech tooling
  and policy. Always one repo set per tech.
- **No External stage.** Forces developers to either lose access to
  third-party packages or get write on internal stages.
- **Implicit virtual ordering.** Insertion order is fragile across
  re-deploys; always set `repositories[]` explicitly.
- **Renaming an existing repo to fit the convention.** Renames
  break every consumer. Use `name_override` in the template to
  mark a legacy name as accepted-as-is, or migrate via
  dual-publish.

Cross-project sharing:

- **Granting write cross-project.** Removes the supply-chain
  boundary. Always read-only.
- **Hard-coding producer credentials in the smart-remote.** Use
  the consumer project's machine identity.
- **Sharing an `external-remote` repo.** That repo is already a
  proxy; re-sharing creates a chain that breaks credential trust.
  Share the producer's `prod-local` instead.

## Further reading

[`projects-api.md`](projects-api.md) and
[`oidc-integration.md`](oidc-integration.md) for endpoint shapes;
[`project-templates-artifactory-repo.md`](project-templates-artifactory-repo.md)
for the templates-repo discovery chain.
