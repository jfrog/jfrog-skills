# JFrog Projects best practices

When to read this file:

- Designing a new JFrog Project from scratch (Phase 1: define the entity).
- Choosing an identity and access strategy for a project (Phase 2: RBAC,
  members, OIDC).
- Picking between project-creation archetypes for an organization.
- Deciding whether a use case fits the "Team = Project" model or a different
  scope.

For the four-part repository naming convention, virtual aggregator pattern,
the External-stage pattern, and the two collaboration patterns (push vs.
pull), see Phases 3+4 in `projects-best-practices-repos.md` (added by the
`jfrog-project-repo-structure` skill).

For endpoint-level call examples, see [`projects-api.md`](projects-api.md)
and [`oidc-integration.md`](oidc-integration.md).

Sources:
[Projects Best Practices](https://docs.jfrog.com/projects/docs/projects-best-practices),
[Projects Setup Best Practices](https://docs.jfrog.com/projects/docs/projects-setup-best-practices),
[Create a Project](https://docs.jfrog.com/projects/docs/create-a-project),
[Project Roles and Members Concepts](https://docs.jfrog.com/projects/docs/project-roles-and-members-concepts),
[OpenID Connect Integration](https://docs.jfrog.com/administration/docs/openid-connect-integration).

## Why projects exist

Projects are the **enterprise-scale management unit**. They map a logical
business entity (team, application, microservice, GitHub org) to a bundle of
JFrog resources (repositories, builds, release bundles, members, roles,
environments) so that platform teams can delegate authority and apply
governance without becoming a bottleneck.

Use a project when any of these hold:

- A team needs its own repositories, members, and lifecycle, isolated from
  other teams.
- A platform admin wants to delegate day-to-day setup (members, repos) to a
  Project Admin without granting platform-wide rights.
- Cost, storage, or vulnerability scope must be reportable per business unit.
- A naming-prefix convention is needed across all of a team's resources for
  search, filter, and audit.

Do not create a project for ad-hoc shared infrastructure (golden images,
public mirrors). Those usually live in a dedicated "shared services" project
or as platform-level resources.

## Phase 1 — Defining the project entity

Performed by the **Platform Admin**. See
[Create a Project](https://docs.jfrog.com/projects/docs/create-a-project) for
the UI flow; the same fields apply through the API in
[`projects-api.md`](projects-api.md).

### Project scope

The default recommendation is **"Team = Project"**: one project per single
team's workspace. Developers get a single virtual repository URL for all
package management; permission management happens once per team.

Alternative scopes that work in practice:

- **Application = Project** — one project per business application. Useful
  when the application has a stable funding/budget identity.
- **Budget ID = Project** — one project per internal budget identifier.
  Survives team restructuring because budget IDs outlive teams.
- **External org = Project** — mirror an external GitHub or GitLab org as a
  project to match source-control structure.

Avoid "one project per repo" (too granular, defeats RBAC) and
"one project for everyone" (defeats isolation, the global-permission
anti-pattern).

### Project key

The project key is the **single most important Phase 1 decision** because it
is **immutable** and is used as a **prefix** on every repository created
inside the project. Bad keys haunt the platform.

Constraints:

- 2–32 characters.
- Lowercase alphanumeric and hyphens only.
- Must start with a letter (no leading digit).
- No leading or trailing hyphen.

Conventions (pick one and stick with it):

- **Team key**: short, mnemonic, stable across reorgs (`payments`, `cloud`,
  `web`).
- **Budget ID**: opaque but stable (`fin-1042`, `ent-7501`).
- **App ID from internal app catalog**: useful when an authoritative ID
  already exists (`app-04217`).

If the user proposes a key that violates the rules, surface the violation and
ask for a corrected key — never silently mangle it.

### Storage quota

The default is **Unlimited**. Best practice is to set a quota at creation
time even when generous, so a single team cannot exhaust shared storage.

Behaviour reported by JFrog:

- Notification at **75% reached** (warning).
- Error at **100% reached**; deployments may be blocked depending on platform
  version. Confirm in the target deployment before relying on the block.
- Quota measures the total virtual size of repositories assigned to the
  project.

Set quotas in GB. Document in your template that the quota is editable later
via the project Update endpoint.

### Admin privileges

Three flags on `admin_privileges`:

- `manage_members` — Project Admins can add/remove users and groups in this
  project. Recommended **on** for delegated-admin archetypes; **off** when a
  central platform team owns membership.
- `manage_resources` — Project Admins can create, update, delete
  repositories, builds, and release bundles in this project. Recommended
  **on** for the "Team = Project" model; **off** when the platform team
  exclusively provisions infrastructure.
- `index_resources` — Project Admins can mark which repositories, builds,
  and release bundles are indexed by Xray. Recommended **on** if the project
  uses Xray; otherwise irrelevant.

Newer Artifactory versions (7.146.0+) split create/update/delete permissions
on remote vs. local vs. virtual repositories — check the current platform
version before locking a privilege model.

### Project Admins

Assign **groups** to the Project Admin role, not individual users.
Group-based admin survives staff churn and aligns with IdP source of truth.
Users assigned the Platform Administrator role are tagged `Admin`
automatically and do not need explicit Project Admin assignment.

## Phase 2 — Identity and access strategy

Project-based RBAC replaces global permission targets. Three role tiers are
relevant (see
[Project Roles and Members Concepts](https://docs.jfrog.com/projects/docs/project-roles-and-members-concepts)):

- **Platform roles** — apply across the whole platform; Platform Admin is
  the canonical example.
- **Global roles** — defined platform-wide but assignable inside a project.
  Useful for shared role definitions ("Developer", "Release Manager") that
  every project should have.
- **Project roles** — defined inside a single project, scoped by environment
  (DEV, PROD, etc.) and bound to specific actions.

### RBAC by environment, not by repository

Phase 2 best practice is to map roles to **environments/stages** rather than
individual repositories. As an artifact moves DEV → QA → PROD, access
changes automatically based on which environment hosts it. New members
inherit the right access by being assigned a role; nobody edits per-repo
permissions.

### Group-first membership

Always model project membership as **groups with roles**, not as users with
roles:

- Maps cleanly to IdP groups synced via SAML/SCIM/LDAP.
- Survives team rotation without manual grant/revoke per user.
- Reduces audit surface area.

The [`projects-api.md`](projects-api.md) `PUT /projects/<key>/users/<u>` and
`PUT /projects/<key>/groups/<g>` endpoints both exist; the user variant is a
last resort for service accounts that cannot belong to a group.

### Predefined roles

Use predefined roles when they fit. Each is documented in
[`projects-api.md`](projects-api.md):

- **Project Admin** — full project control.
- **Developer** — read/write/annotate repos, read builds.
- **Contributor** — read/write inside a stage, narrower than Developer.
- **Viewer** — read-only.
- **Release Manager** — promote/distribute, scoped to PROD environments.
- **Security Manager** — Xray watches, policies, ignore rules.
- **AppTrust Manager**, **Model Governor**, **Model Developer** — domain-
  specific roles.

Define a custom role only when no predefined role matches the access pattern.
Custom-role definitions differ across projects, so a multi-project report
must fetch roles **per project** — see the agent rules in
[`platform-access-entities.md`](platform-access-entities.md).

### OIDC for CI authentication

Authenticate CI pipelines with OpenID Connect. Static API keys and refresh
tokens stored in CI secrets are an anti-pattern. OIDC issues short-lived
tokens scoped via **identity mappings** that bind incoming claims (e.g.
GitHub `repository`, `ref`, `workflow`) to a project role or group scope.

Setup outline (see [`oidc-integration.md`](oidc-integration.md) for the
endpoint-level details):

1. Create the OIDC provider — `POST /access/api/v1/oidc`.
2. Create one or more identity mappings on the provider — each mapping
   pairs a claim filter with a token spec
   (`scope: applied-permissions/groups:<group>`, `expires_in`, etc.).
3. Use the per-CI claim recipes (GitHub Actions, GitLab CI, generic) so the
   incoming token's `repository` / `ref` / `workflow` claims trigger the
   right mapping.

OIDC provider creation is platform-wide; identity mappings are
**provider-scoped** but their token-spec scope can be project-specific
(`applied-permissions/groups:team-x-devs`). One platform OIDC provider
typically serves many projects.

## Customer archetypes

The three archetypes from the public best-practices doc become blueprint
files in `skills/jfrog/assets/project-templates/`. Pick one as the starting
point for any new project.

### `team-default` — single team, default settings

Best fit:

- A single product team that owns one application or service.
- No mandate to standardize across hundreds of teams.
- Wants the quickest path to a working project.

Phase 1: project key matches the team name; quota set at a generous default
(50 GB); all three `admin_privileges` flags on; Project Admins are the
team's lead group.

Phase 2: predefined Developer + Release Manager roles only; one group per
role; OIDC optional (configurable but not required by the blueprint).

### `enterprise-budget-id` — large enterprise, mapped by budget ID

Best fit:

- Project key tied to an immutable internal identifier (budget, app catalog,
  funding code) that survives reorgs.
- Strict three-tier flow: Curation → Central → Certified (mapped to roles
  and stages in Phase 3+4).
- High volume of projects provisioned by automation.

Phase 1: project key is the budget ID (`fin-1042`, `ent-7501`); quota is
sized per budget tier; `admin_privileges.manage_members` is **off** because
membership comes from a central IdP sync.

Phase 2: predefined Developer in Curation/Central; predefined Release
Manager in Certified; OIDC required for CI publishing into Central; identity
mappings tied to the source GitHub org and repo.

### `delegated-admin` — heavy delegation, application-team-driven

Best fit:

- Platform team is small; thousands of applications need self-service.
- Application owners are trusted to manage their own users and repos.
- IdP-managed groups carry all membership; no manual user assignment.

Phase 1: all three `admin_privileges` flags **on**; Project Admins are the
application's owner group.

Phase 2: predefined Developer + Release Manager + Security Manager;
groups-only membership (`members[].user` empty by design); OIDC required and
mapped per source repository.

## Anti-patterns

- **Project per repository.** Defeats RBAC and inflates project count
  against the subscription allocation.
- **Project key based on the year, version, or release.** Keys are
  immutable; tie them to stable identifiers.
- **Members assigned as users instead of groups.** Creates audit drift and
  manual onboarding cost.
- **Permission targets on individual repos inside a project.** Use roles
  bound to environments instead.
- **Static API keys for CI.** Use OIDC.
- **Storage quota left Unlimited in production.** Set a quota at creation
  time; raise it later if needed.
- **Reusing one project's role payload as representative of another's.**
  Custom-role definitions differ — fetch per project.

## Verifying a fresh project

After Phase 1+2 apply, confirm:

- `GET /access/api/v1/projects/<key>` returns the expected `display_name`,
  `description`, `admin_privileges`, and quota.
- `GET /access/api/v1/projects/<key>/users` and `/groups` show the intended
  members.
- `GET /access/api/v1/projects/<key>/roles` includes any custom roles you
  defined and the predefined roles you expect to use.
- `GET /access/api/v1/oidc/<provider>` and the identity-mapping list show
  the expected claim filters and token specs.
- `GET /artifactory/api/repositories?project=<key>` returns the empty list
  (Phase 3 will populate it).

## Further reading

- [`projects-api.md`](projects-api.md) — endpoint reference for project CRUD,
  members, roles, environments, repository assignment.
- [`oidc-integration.md`](oidc-integration.md) — provider config and
  identity-mapping recipes.
- [`platform-access-entities.md`](platform-access-entities.md) — entity
  model and agent rules.
- [Projects Setup Best Practices](https://docs.jfrog.com/projects/docs/projects-setup-best-practices)
  — full source for Phases 1–4.
- [Project Roles and Members Concepts](https://docs.jfrog.com/projects/docs/project-roles-and-members-concepts)
- [OpenID Connect Integration](https://docs.jfrog.com/administration/docs/openid-connect-integration)
