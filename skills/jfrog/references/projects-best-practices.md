# JFrog Projects best practices

One consolidated doctrine document for JFrog Projects, used by both
the [`jfrog-project-creation`](../../jfrog-project-creation/SKILL.md)
and
[`jfrog-project-repo-structure`](../../jfrog-project-repo-structure/SKILL.md)
workflow skills.

Read this file when designing a new project, choosing an identity
strategy, picking an archetype, configuring repos and stages, or
deciding how two projects should share artifacts.

Endpoint shapes: [`projects-api.md`](projects-api.md),
[`artifactory-operations.md`](artifactory-operations.md),
[`oidc-integration.md`](oidc-integration.md). Templates repo and
fetch chain:
[`project-templates-artifactory-repo.md`](project-templates-artifactory-repo.md).
State machine and outcome JSON:
[`projects-verification-contract.md`](projects-verification-contract.md).

Sources:
[Projects Best Practices](https://docs.jfrog.com/projects/docs/projects-best-practices),
[Projects Setup Best Practices](https://docs.jfrog.com/projects/docs/projects-setup-best-practices),
[Repository naming convention](https://docs.jfrog.com/projects/docs/projects-repository-naming-convention),
[Sharing repositories between projects](https://docs.jfrog.com/projects/docs/sharing-repositories-between-projects),
[OpenID Connect Integration](https://docs.jfrog.com/administration/docs/openid-connect-integration).

## Why projects exist

Projects are the **enterprise-scale management unit**. They bundle
repositories, builds, release bundles, members, roles, and
environments under one logical entity (team, application, GitHub
org) so platform teams can delegate authority and apply governance
without becoming a bottleneck.

Use a project when a team needs isolated resources and lifecycle,
when day-to-day setup must be delegated without platform-wide
rights, when cost / storage / vulnerability scope must be
reportable per business unit, or when a naming prefix is needed
for search, filter, and audit.

Do not create a project for ad-hoc shared infrastructure (golden
images, public mirrors). Those belong in a dedicated "shared
services" project or as platform-level resources.

## Defining the project entity

### Project scope

The default recommendation is **"Team = Project"**: one project per
single team's workspace. Developers get a single virtual repository
URL for all package management; permission management happens once
per team.

Alternative scopes that work in practice:

- **Application = Project** — one project per business application.
  Useful when the application has a stable funding/budget identity.
- **Budget ID = Project** — one project per internal budget
  identifier. Survives team restructuring because budget IDs
  outlive teams.
- **External org = Project** — mirror an external GitHub or GitLab
  org as a project to match source-control structure.

Avoid "one project per repo" (too granular, defeats RBAC) and "one
project for everyone" (defeats isolation, the global-permission
anti-pattern).

### Project key

The project key is the single most important entity decision
because it is **immutable** and is used as a **prefix** on every
repository created inside the project. Bad keys haunt the platform.

Constraints:

- 2–32 characters.
- Lowercase alphanumeric and hyphens only.
- Must start with a letter (no leading digit).
- No leading or trailing hyphen.

Conventions (pick one and stick with it):

- **Team key**: short, mnemonic, stable across reorgs (`payments`,
  `cloud`, `web`).
- **Budget ID**: opaque but stable (`fin-1042`, `ent-7501`).
- **App ID from internal app catalog**: useful when an
  authoritative ID already exists (`app-04217`).

If the proposed key violates the rules, surface the violation and
ask for a corrected key — never silently mangle it.

### Storage quota

Default is **Unlimited**. Set a quota at creation time even when
generous, so a single team cannot exhaust shared storage. JFrog
warns at 75% and errors at 100% (deployments may be blocked
depending on platform version); quota measures total virtual size
of assigned repositories. Set in GB; editable later via the project
Update endpoint.

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

### Project Admins

Assign **groups** to the Project Admin role, not individual users.
Group-based admin survives staff churn and aligns with the IdP.
Platform Administrators are tagged `Admin` automatically and do not
need explicit Project Admin assignment.

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

Always model project membership as **groups with roles**, not as
users with roles:

- Maps cleanly to IdP groups synced via SAML/SCIM/LDAP.
- Survives team rotation without manual grant/revoke per user.
- Reduces audit surface area.

The [`projects-api.md`](projects-api.md)
`PUT /projects/<key>/users/<u>` and `PUT /projects/<key>/groups/<g>`
endpoints both exist; the user variant is a last resort for service
accounts that cannot belong to a group.

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

Authenticate CI pipelines with OpenID Connect. Static API keys and
refresh tokens stored in CI secrets are an anti-pattern. OIDC
issues short-lived tokens scoped via **identity mappings** that
bind incoming claims (e.g. GitHub `repository`, `ref`, `workflow`)
to a project role or group scope.

Provider creation is platform-wide; identity mappings are
provider-scoped but their token-spec scope can be project-specific
(`applied-permissions/groups:team-x-devs`). One platform OIDC
provider typically serves many projects. See
[`oidc-integration.md`](oidc-integration.md) for the endpoint table
and per-CI claim recipes.

## Customer archetypes

Three archetypes from the public best-practices doc become
blueprint files in `skills/jfrog/assets/project-templates/`. Pick
one as the starting point for any new project.

### `team-default` — single team, default settings

For a single product team owning one application or service; no
mandate to standardize across hundreds of teams; wants the quickest
path to a working project.

- Project key matches the team name.
- Quota at a generous default (50 GB).
- All three `admin_privileges` flags on.
- Project Admins are the team's lead group.
- Predefined Developer + Release Manager roles only; one group per
  role.
- OIDC optional.

### `enterprise-budget-id` — large enterprise, mapped by budget ID

For project keys tied to an immutable internal identifier (budget,
app catalog, funding code) that survives reorgs; strict three-tier
flow (Curation → Central → Certified); high volume of projects
provisioned by automation.

- Project key is the budget ID (`fin-1042`, `ent-7501`).
- Quota sized per budget tier.
- `admin_privileges.manage_members` **off** (central IdP sync owns
  membership).
- Predefined Developer in Curation/Central, Release Manager in
  Certified.
- OIDC required for CI publishing into Central; identity mappings
  tied to the source GitHub org and repo.

### `delegated-admin` — heavy delegation, application-team-driven

For small platform teams supporting thousands of applications
self-service; application owners manage their own users and repos;
IdP-managed groups carry all membership.

- All three `admin_privileges` flags on.
- Project Admins are the application's owner group.
- Predefined Developer + Release Manager + Security Manager.
- Groups-only membership (`members[].user` empty by design).
- OIDC required, mapped per source repository.

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

For each declared technology, the standard set is one **local** per
stage, exactly one **remote** on the External stage with the
canonical upstream URL preconfigured (Maven Central, npm registry,
PyPI, etc.), and one **virtual** that aggregates all of the above
with explicit resolution order. Developers point their package
manager at the virtual and never touch locals or remotes directly.

Always proxy upstream; never let developers point to ad-hoc remotes. The doctrine is the *shape*, not a fixed count.

### Virtual aggregator with explicit resolution order

The virtual repository is the single resolution endpoint developers
touch. The recommended order is:

```
prod  →  dev  →  external  →  smart-remotes  (if any)
```

Rationale:

- `prod` first so released artifacts shadow in-progress versions if
  a version collision happens.
- `dev` second so day-to-day work resolves locally.
- `external` last among internal repos so an internal artifact
  always wins over the same coordinate from a public source
  (supply-chain defence).
- Smart-remote consumers (cross-project sharing, below) trail at
  the end.

The apply script never relies on the insertion order of the
`repositories[]` field on the virtual config — it always rewrites
the field with the explicit order from the template.

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
- **Static API keys for CI.** Use OIDC.
- **Storage quota left Unlimited in production.** Set a quota at
  creation time; raise it later if needed.
- **Reusing one project's role payload as representative of
  another's.** Custom-role definitions differ — fetch per project.

Repository structure:

- **A single `prod` local for all tech.** Defeats per-tech tooling
  and policy. Always one repo set per tech.
- **No External stage.** Forces developers to either lose access to
  third-party packages or get write on internal stages.
- **Implicit virtual ordering.** Insertion order is fragile across
  re-deploys; always set `repositories[]` explicitly.
- **Naming-prefix-only convention enforcement.** Rely on the
  `project=<key>` query parameter for project membership, not on
  the prefix. The 4-part rule is for *human* readability and
  tooling hooks, not platform-side enforcement.
- **Renaming an existing repo to fit the convention.** Renames
  break every consumer. Use `name_override` in the template to
  mark a legacy name as accepted-as-is, or migrate via
  dual-publish, never via in-place rename.

Cross-project sharing:

- **Granting write cross-project.** Removes the supply-chain
  boundary. Always read-only.
- **Hard-coding producer credentials in the smart-remote.** Use
  the consumer project's machine identity.
- **Sharing an `external-remote` repo.** That repo is already a
  proxy; re-sharing creates a chain that breaks credential trust.
  Share the producer's `prod-local` instead.
- **Sharing a `dev-local` for external consumption.** Dev
  artifacts are not stable. Share `prod-local` only.

## Further reading

[`projects-api.md`](projects-api.md) (endpoints),
[`oidc-integration.md`](oidc-integration.md) (OIDC recipes),
[`artifactory-operations.md`](artifactory-operations.md) (repo
CRUD), [`platform-access-entities.md`](platform-access-entities.md)
(entity model and agent rules),
[`project-templates-artifactory-repo.md`](project-templates-artifactory-repo.md)
(templates discovery),
[`projects-verification-contract.md`](projects-verification-contract.md)
(state machine and outcome JSON).
