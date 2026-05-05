> **Status: review preview, not for merge.** This design doc lives on a stakeholder-review branch and is not intended to ship as-is.

# JFrog Project Creation Skill — Discovery, Design, and Implementation Summary

A standalone summary of the discovery work against the public
[`jfrog/jfrog-skills`](https://github.com/jfrog/jfrog-skills) repository,
the resulting design, and the Phase 1+2 implementation. Published on a
stakeholder-review branch alongside the proposed skill changes so
reviewers can read code and design context in one place.

## At a glance

Two deliverables were requested:

1. A **discovery** of how the existing JFrog Skills cover four topic areas
   (creating a project, project best practices, OIDC setup, adding users
   and groups), an assessment of quality, and a gap analysis.
2. A **proposal** for new Project-related skills aligned with the
   seven-skill roadmap below, integrating cleanly with what already exists.

This document delivers both, plus a working implementation of Phases 1+2
(the project entity + identity and access) packaged as a new
`jfrog-project-creation` workflow skill in the local clone of the repo.

The implementation is intentionally **opinionated** (best-practices by
default), **deterministic** (a script applies the result idempotently),
and **safe** (read-before-write per resource; the AI never mutates the
JFrog server outside the script).

## Source documents driving the design

- [Get Started with Projects](https://docs.jfrog.com/projects/docs/projects)
- [Projects Best Practices](https://docs.jfrog.com/projects/docs/projects-best-practices)
- [Projects Setup Best Practices](https://docs.jfrog.com/projects/docs/projects-setup-best-practices)
- [Create a Project](https://docs.jfrog.com/projects/docs/create-a-project)
- [Project Roles and Members Concepts](https://docs.jfrog.com/projects/docs/project-roles-and-members-concepts)
- [OpenID Connect Integration](https://docs.jfrog.com/administration/docs/openid-connect-integration)
- The existing skill repo's `ARCHITECTURE.md`, `CONTRIBUTING.md`, base
  `SKILL.md`, and `references/` directory.

## Discovery findings (deliverable 1)

Four topic areas, scored as "covered well", "covered partially", or
"missing", with concrete evidence.

### 1. Creating a project — covered tactically, not strategically

- **What's there.** [`references/projects-api.md`](https://github.com/jfrog/jfrog-skills/blob/main/skills/jfrog/references/projects-api.md)
  has the full endpoint set (CRUD, members, roles, environments, repo
  assignment), error codes, and `project_key` rules.
  [`references/platform-access-entities.md`](https://github.com/jfrog/jfrog-skills/blob/main/skills/jfrog/references/platform-access-entities.md)
  has the entity model with an ER diagram and two anti-pitfall rules.
- **Quality.** Strong as endpoint reference. Each call has payload, auth
  note, and error codes.
- **Gaps.**
  - No procedural orchestration of the four-tab official creation flow
    (Configure → Admins → Repositories → Destinations).
  - No best-practice opinionation: "Team = Project" model, key
    conventions, storage-quota semantics.
  - Distribution targets / Edge nodes never mentioned in project context.
  - The `project_key` rule was incomplete: the skill said "lowercase
    alphanumeric, hyphens"; the official UI doc adds **must start with a
    letter**.

### 2. Project best practices — almost entirely missing

- **What's there.** Two narrow agent rules in
  `platform-access-entities.md` (don't infer `projectKey` from repo name;
  fetch roles per project). That's it.
- **Quality.** N/A — content category does not really exist.
- **Gaps.** All four phases of the
  [Setup Best Practices](https://docs.jfrog.com/projects/docs/projects-setup-best-practices)
  are absent:
  - Phase 1 — Project entity (scope, key conventions, quota).
  - Phase 2 — Identity and access (RBAC by stage, group-first, OIDC).
  - Phase 3 — Repository scoping (4-part naming, virtual aggregator,
    External stage).
  - Phase 4 — Collaboration (push vs pull sharing, read-only consumer).
  The three customer archetypes (mapped-by-budget-ID, delegated-admin,
  zero-touch onboarding) are also unrepresented.

### 3. OIDC setup — minimal and disconnected from projects

- **What's there.** Two endpoints in
  [`references/platform-admin-api-gaps.md`](https://github.com/jfrog/jfrog-skills/blob/main/skills/jfrog/references/platform-admin-api-gaps.md)
  §OIDC (list, create generic provider). `exchange-oidc-token` is listed
  as a top-level CLI command in `SKILL.md` but documented nowhere.
- **Quality.** Bare bones. Cannot get a user to a working CI integration
  from this content.
- **Gaps.**
  - **Identity mappings** — *the* mechanism that binds an OIDC claim
    (e.g., GitHub repo + branch) to a project role. Completely absent.
  - Provider-type templates for GitHub Actions, GitLab CI, Azure.
  - Claim mapping cookbook for common CI systems.
  - End-to-end `exchange-oidc-token` workflow.
  - The conceptual link between Phase 2 of best practices and OIDC.

### 4. Adding users and groups — operations covered, orchestration missing

- **What's there.** Full user/group CRUD in `platform-admin-api-gaps.md`,
  group CLI in `artifactory-operations.md`, project membership in
  `projects-api.md`, SCIM list endpoint, group fields in entity reference.
- **Quality.** Good at the endpoint level.
- **Gaps.**
  - No bulk onboarding flow.
  - "Prefer groups over users" doctrine is not stated anywhere.
  - SAML/LDAP/SCIM provisioning has no setup workflow.
  - No project-token-strategy guidance (when to use a project-scoped
    token vs an OIDC-issued token).

### Cross-cutting Q&A coverage gaps

- No reasoning content for "given my org, how should I structure
  projects?"
- No template/blueprint pattern, despite the docs explicitly calling out
  "automated self-service" and "zero-touch onboarding" as customer goals.
- No project verification helpers — "after I create it, what do I
  check?".

### Discovery summary

```mermaid
flowchart LR
    A[Topic] --> B1[Creating a project]
    A --> B2[Project best practices]
    A --> B3[OIDC setup]
    A --> B4[Users and groups]
    B1 --> C1[Tactical: covered<br/>Strategic: missing]
    B2 --> C2[Almost entirely missing]
    B3 --> C3[Bare bones, no project link]
    B4 --> C4[Operations covered<br/>Orchestration missing]
```

## Design decisions (resolved during brainstorming)

Two key choices made before implementation, recorded here for review.

### Decision A — Phase 1+2 are bundled into one skill

The seven-skill roadmap separates "Project creation" and "Project
identity and access configuration". This implementation **collapses
Phase 1+2 into a single workflow skill** because they are both Platform-
Admin work performed at first project setup. Splitting them creates an
artificial seam (the agent has to switch skills mid-conversation just to
add OIDC).

The standalone "Project identity and access" skill — if still desired —
naturally becomes the *post-creation* identity skill: rotate OIDC, add a
second IdP, manage more groups later. **This is flagged for review
before merging.**

### Decision B — Template authority: ship blueprints, user owns the output

Two alternatives considered:

- **A.** AI emits a JSON template; the user owns and version-controls it.
  No blueprints in the package.
- **B.** Skills package ships canonical blueprints; AI customises one;
  customised output is written to the user's repo.

Picked **B with the output path of A**. The package ships three
blueprints; the AI helps the user pick and customise one; the customised
result is written to a path the user names (typically inside their own
repo). From that moment, the user owns the file — they version it, PR-
review it, run the apply script from CI.

This delivers best-practices-by-default while keeping the user-owned
deployment boundary clean.

```mermaid
flowchart LR
    Pkg["jfrog-skills package<br/>(source of patterns)"] --> Bps["assets/project-templates/<br/>schema.json + 3 blueprints"]
    Bps --> AI["jfrog-project-creation skill<br/>customises blueprint"]
    AI --> Out["Customised JSON<br/>at user-named path"]
    Out --> User["User repo<br/>(source of deployments)"]
    User --> Script["jfrog-project-create-from-template.sh<br/>(apply, idempotent)"]
    Script --> JFrog["JFrog Platform"]
```

## What was added (Phase 1+2 implementation)

Eleven changes across the base skill and a new workflow skill. All
respect the existing repo's
[`ARCHITECTURE.md`](https://github.com/jfrog/jfrog-skills/blob/main/ARCHITECTURE.md)
and
[`CONTRIBUTING.md`](https://github.com/jfrog/jfrog-skills/blob/main/CONTRIBUTING.md)
conventions.

### Base skill additions (`skills/jfrog/`)

- **`references/projects-api.md`** — fixed `project_key` rule (must start
  with a letter; immutable; used as repo prefix).
- **`references/projects-best-practices.md`** *(new, ~315 lines)* —
  Phase 1+2 doctrine: "Team = Project" model, key conventions, quota
  semantics, admin-privilege decisions, RBAC-by-stage, group-first
  membership, OIDC strategy, three customer archetypes, anti-patterns,
  verification checklist.
- **`references/oidc-integration.md`** *(new, ~290 lines)* — provider
  CRUD, identity mappings (the missing piece), per-CI claim recipes for
  GitHub Actions / GitLab CI / generic, `jf exchange-oidc-token`
  workflow, listing/revoking issued tokens, common errors.
- **`references/platform-admin-api-gaps.md`** — OIDC section trimmed to
  a one-line pointer at the new file (no duplication).
- **`assets/project-templates/schema.json`** *(new)* — JSON Schema with
  strict Phase 1+2 validation; reserved-but-loose Phase 3+4 slots.
- **`assets/project-templates/{team-default,enterprise-budget-id,delegated-admin}.json`**
  *(new)* — three shipped blueprints, one per customer archetype.
- **`SKILL.md`** — Platform-administration routing updated to point at
  the two new doctrine files and the new workflow skill.

### New workflow skill (`skills/jfrog-project-creation/`)

- **`SKILL.md`** — workflow-role frontmatter, prereq on the base skill,
  mandatory entry steps (server resolution, environment check, platform-
  admin verification, existing-project list), routing to references and
  scripts.
- **`references/creation-flow.md`** — six-stage conversational
  walkthrough.
- **`references/verification-and-idempotency.md`** — per-resource
  idempotency contract, outcome-JSON schema, post-apply checks,
  partial-failure recovery.
- **`scripts/jfrog-project-create-from-template.sh`** — idempotent
  applier (GET-before-PUT/POST), `--server-id` and `--dry-run` flags,
  refuses non-1.x `template_version`, structured outcome JSON.
- **`scripts/jfrog-project-validate-template.sh`** — offline structural
  checks; optional `ajv` schema validation; `--check-platform` delegates
  to apply `--dry-run`.

### Repo-level updates

- **`README.md`** — added the new skill to the install commands.
- **`ARCHITECTURE.md`** — workflow-skills diagram and reference-files
  table updated.

## Master end-to-end flow (who does what)

A single sequence diagram covering the full project lifecycle: Phases
1+2 (delivered now), Phases 3+4 (planned), and Day 2 CI use. Three human
actors and two AI agents each have a distinct lane.

```mermaid
sequenceDiagram
    actor PA as Platform Admin (human)
    participant AI1 as AI agent<br/>jfrog-project-creation
    participant FS as User-owned repo<br/>(template file on disk)
    participant Sc1 as Apply script<br/>create-from-template.sh
    participant JF as JFrog Platform
    actor PRA as Project Admin (human)
    participant AI2 as AI agent<br/>jfrog-project-repo-structure<br/>(Phase 3+4, planned)
    participant Sc2 as Apply script<br/>apply-repo-structure.sh<br/>(planned)
    actor CI as CI runner<br/>(GitHub Actions / GitLab CI)

    Note over PA,JF: Phase 1+2 — Platform Admin work (delivered)
    PA->>AI1: "create a project for team X"
    AI1->>JF: GET existing projects, verify caller is Platform Admin
    JF-->>AI1: project list + permissions
    AI1->>PA: pick blueprint, ask Phase 1+2 questions
    PA-->>AI1: answers (key, quota, admins, roles, members, OIDC)
    AI1->>PA: render customised JSON template (preview only)
    PA-->>AI1: approve write + apply
    AI1->>FS: write template to user-named path
    AI1->>Sc1: invoke with template path
    loop For each resource: project, custom roles, members, OIDC provider, OIDC mappings
        Sc1->>JF: GET resource (read-before-write)
        JF-->>Sc1: 404 or 200 + current state
        Sc1->>JF: POST/PUT (only if needed)
    end
    Sc1-->>AI1: structured outcome JSON
    AI1->>PA: per-resource summary (created / already_exists / updated / skipped)

    Note over PA,PRA: Hand-off — Platform Admin assigns Project Admins<br/>(part of Phase 1+2 outcome)

    Note over PRA,JF: Phase 3+4 — Project Admin work (planned)
    PRA->>AI2: "set up our repository structure for project X"
    AI2->>JF: GET project, verify caller is Project Admin (or Platform Admin)
    JF-->>AI2: project + current repos
    AI2->>PRA: ask Phase 3 questions (techs, stages) and Phase 4 (sharing intent)
    PRA-->>AI2: answers
    AI2->>PRA: render extended template (same JSON, new sections)
    PRA-->>AI2: approve apply
    AI2->>FS: extend the same template file
    AI2->>Sc2: invoke with extended template
    loop For each repo, virtual aggregator, sharing entry
        Sc2->>JF: GET-before-write
        Sc2->>JF: POST/PUT (only if needed)
    end
    Sc2-->>AI2: outcome JSON
    AI2->>PRA: summary + naming-convention validation report

    Note over CI,JF: Day 2 — CI publishes through OIDC mappings created in Phase 2
    CI->>JF: jf exchange-oidc-token (CI's OIDC ID token)
    JF-->>CI: short-lived JFrog access token (scope per identity mapping)
    CI->>JF: publish artifacts via the project's virtual repo
```

Reading the diagram:

- **Boxed lanes** are software (AI agents, scripts, the platform, the
  template file). **Stick figures** are humans.
- **AI agents only read** — they ask questions, fetch state for context,
  preview JSON, and invoke scripts. They never mutate the JFrog server
  directly.
- **Scripts are the only mutators**. They are deterministic, idempotent,
  and emit structured outcome JSON.
- **The template file is the contract** between AI and script, and
  between Phase 1+2 and Phase 3+4. Both phases extend the same file.
- **The persona switches** between phases: Phase 1+2 needs Platform-Admin
  rights, Phase 3+4 needs Project-Admin rights (or Platform-Admin), Day 2
  uses scoped OIDC-issued tokens with no human in the loop.

## Updated layered architecture

```mermaid
flowchart TD
    subgraph base ["Base skill (jfrog)"]
        Core["SKILL.md"]
        BP["references/projects-best-practices.md (new)"]
        OIDC["references/oidc-integration.md (new)"]
        ProjAPI["references/projects-api.md (fixed)"]
        Schema["assets/project-templates/schema.json (new)"]
        Bps["assets/project-templates/team-default.json<br/>+ enterprise-budget-id.json<br/>+ delegated-admin.json"]
    end

    subgraph wf ["Workflow skills"]
        Pkg["jfrog-package-safety-and-download (existing)"]
        Create["jfrog-project-creation (new)"]
        Future["jfrog-project-repo-structure (Phase 3+4 plan)"]
        Future2["jfrog-project-cicd / application / curation / policies (planned)"]
    end

    Create -->|"reads"| BP
    Create -->|"reads"| OIDC
    Create -->|"reads"| ProjAPI
    Create -->|"customises"| Bps
    Create -->|"validates against"| Schema
    Pkg -.->|"prereq"| Core
    Create -.->|"prereq"| Core
    Future -.->|"prereq"| Core
    Future2 -.->|"prereq"| Core
```

## Two-mode design

The skill operates in two distinct modes, chosen automatically based on
whether a template already exists.

```mermaid
flowchart TD
    User["User asks: 'create my first project'"] --> Skill["jfrog-project-creation"]
    Skill --> Mode{"Have a template already?"}
    Mode -->|"no"| AI["Interactive AI mode<br/>(read-only conversation)"]
    Mode -->|"yes"| Apply["Script mode<br/>(deterministic apply)"]
    AI --> Picks["1. Pick blueprint"]
    Picks --> Custom["2. Customise Phase 1+2 fields"]
    Custom --> Preview["3. Preview JSON"]
    Preview --> Approve{"User approves?"}
    Approve -->|"no"| Custom
    Approve -->|"yes"| Write["4. Write template to user-chosen path"]
    Write --> Apply
    Apply --> Validate["Validate (offline structural + optional dry-run)"]
    Validate --> Run["Apply via jfrog-project-create-from-template.sh"]
    Run --> Verify["Run post-apply checks"]
    Verify --> Done["Report outcome"]
```

The cautious-execution gate is at step 3/4: nothing on the JFrog server
is mutated until the user has reviewed the JSON and approved writing it
to disk. The script is the **only** thing that mutates state.

## Template lifecycle: from design to repeated use

The template is the persisted record of every Phase 1+2 decision made
during the AI conversation. Once it exists on disk, the JFrog Platform
can be reconstructed from it any number of times, against any compatible
JFrog server, with no human in the loop.

The template moves through five stages:

1. **Authoring (AI flow).** The agent picks one of the three shipped
   blueprints and customises it field-by-field through Phase 1+2
   questions. The template is **never written to disk and the JFrog
   server is never mutated** until the user explicitly approves at the
   cautious-execution gate.
2. **Emission (handoff).** When the user approves, the AI writes the
   customised JSON to a path the user chooses (typically
   `./projects/<project-key>.json` inside their own repo). **Ownership
   transfers from the skill package to the user at this moment.** The
   shipped blueprints stay frozen as patterns; the emitted file becomes
   the user's source of truth.
3. **Validation (offline).** Before any apply,
   `jfrog-project-validate-template.sh` runs offline structural checks
   against the schema (`project_key` regex, member `oneOf`, OIDC scope
   syntax, role cross-references). Optional `--check-platform` adds
   read-only platform lookups via the apply script's `--dry-run` mode.
4. **Application (idempotent apply).**
   `jfrog-project-create-from-template.sh <path>` reconciles the
   template against the live JFrog server. For each resource: GET; on
   404 → POST/PUT to create; on 200 + matching state → record
   `already_exists`; on 200 + differing state → PUT to update. Every
   action lands in a structured outcome JSON.
5. **Reuse (the deterministic phase).** The same template now has four
   operational uses, each deterministic:
   - **Verify** — re-run apply; everything reports `already_exists`.
   - **Incremental update** — edit a field, re-run; only the changed
     resource reports `updated`.
   - **Replicate** — copy the file, change `project.key` and other
     instance-specific values, apply.
   - **CI-driven onboarding** — commit the template, run the apply
     script from a pipeline.

```mermaid
flowchart LR
    Author["AI flow:<br/>pick blueprint,<br/>customise Phase 1+2"] --> Emit["Emit JSON template<br/>to user-named path"]
    Emit --> Commit["User commits template<br/>to their own repo"]
    Commit --> First["First apply<br/>(creates project)"]
    First --> Pivot{"What next?"}
    Pivot -->|"verify"| First
    Pivot -->|"incremental change"| Edit["Edit template,<br/>re-apply"]
    Pivot -->|"replicate to team Y"| Copy["Copy file,<br/>change key + instance values,<br/>apply"]
    Pivot -->|"automate onboarding"| CI["CI runs apply<br/>on every merge"]
    Edit --> First
    Copy --> Many["Multiple projects<br/>with the same shape"]
    CI --> Many
```

### Cross-project replication

The `enterprise-budget-id` archetype is the canonical example. After the
AI flow produces the first template (say `fin-1042.json`):

1. Copy to `fin-1043.json`.
2. Change `project.key`, `display_name`, the budget-specific group
   names, and the OIDC `claims.repository`.
3. Apply.

Every other decision — `admin_privileges` flags, role split, OIDC
`provider_type` and `audience`, identity-mapping shape, `expires_in`,
the strict three-tier role doctrine — carries over unchanged. A reviewer
comparing two templates side-by-side can verify in one diff that the
only differences are intentional instance-specific values. This is what
enables zero-touch onboarding for hundreds of projects from a small
platform team.

## End-to-end conversation flow

```mermaid
flowchart TD
    S0["User intent: create a project"] --> S1["Stage 1: Discovery"]
    S1 --> S1a["Resolve server"]
    S1a --> S1b["Verify Platform Admin"]
    S1b --> S1c["Fetch existing project list"]
    S1c --> S2["Stage 2: Pick blueprint"]
    S2 --> S2a["team-default / enterprise-budget-id / delegated-admin / custom"]
    S2a --> S3["Stage 3: Phase 1 customise"]
    S3 --> S3a["key, display_name, description, quota_gb, admin_privileges, project admins"]
    S3a --> S4["Stage 4: Phase 2 customise"]
    S4 --> S4a["roles, members, OIDC provider, identity mappings"]
    S4a --> S5["Stage 5: Preview + write"]
    S5 -->|"changes requested"| S3
    S5 -->|"approved"| S6["Stage 6: Apply + verify"]
    S6 --> S6a["validate-template (offline)"]
    S6a --> S6b["create-from-template (apply)"]
    S6b --> S6c["Post-apply checks (project, members, roles, OIDC, repos==[])"]
    S6c --> Done["Summary + next steps"]
```

## Three blueprints — when to use each

A short decision tree:

```mermaid
flowchart TD
    Q1{"Is this for one specific team's<br/>day-to-day work?"} -->|"yes"| Q2{"Heavy delegation desired?<br/>App owners run their own RBAC?"}
    Q1 -->|"no, enterprise-wide standard"| Ent["enterprise-budget-id<br/><br/>Project key = budget/app ID<br/>Central IdP holds membership<br/>OIDC required<br/>3-tier role split"]
    Q2 -->|"yes, application-driven"| Del["delegated-admin<br/><br/>App owners are Project Admin<br/>Groups-only membership<br/>OIDC required"]
    Q2 -->|"no, simple team workspace"| Team["team-default<br/><br/>One team, one workspace<br/>OIDC optional<br/>Predefined roles"]
```

Each blueprint is a starting point; the AI flow customises every field
the user wants to change. The blueprint name is recorded in the
customised template so reviewers know which archetype it derived from.

## Idempotency: per-resource state machine

Every resource the apply script touches follows the same state machine.
This is what makes re-running the script safe.

```mermaid
flowchart LR
    Start["Resource specified<br/>in template"] --> Get["GET resource"]
    Get --> Status{"HTTP status?"}
    Status -->|"404"| Create["POST/PUT to create"]
    Status -->|"200"| Compare{"State matches<br/>template?"}
    Status -->|"other"| Err["Record errored"]
    Compare -->|"yes"| Skip["Record already_exists"]
    Compare -->|"no"| Update["PUT to update"]
    Create --> CR{"Success?"}
    Update --> UR{"Success?"}
    CR -->|"yes"| Created["Record created"]
    CR -->|"no"| Err
    UR -->|"yes"| Updated["Record updated"]
    UR -->|"no"| Err
```

Special cases:

- **PREDEFINED roles** are skipped at the create step (the platform
  ships them) but used at the member-assignment step. Outcome:
  `skipped` with `note: predefined`.
- **Missing platform principals** (group/user does not exist) are
  recorded as `skipped` with `error: principal_missing`. The script
  never creates users or groups; the user fixes that and re-runs.
- **`project_key` mismatch** between template and live project is a
  hard stop: outcome `skipped` with `error: key_mismatch`. The script
  never deletes a project to recreate it.

The script writes a single structured JSON document to stdout
summarising every action. The agent re-reads this file rather than
rerunning the script.

## How each gap is addressed

| Gap area | Pre-existing state | After Phase 1+2 |
| --- | --- | --- |
| Procedural orchestration of project creation | None — endpoints only | `jfrog-project-creation` skill walks the four-tab UI flow conversationally |
| `project_key` rule completeness | Missing "starts with a letter" | Fixed in `projects-api.md`; enforced in schema regex and apply-script regex |
| Best-practice doctrine (Phase 1+2) | Two narrow agent rules | New `references/projects-best-practices.md` with full Phase 1+2 doctrine and three archetypes |
| OIDC identity mappings | Absent | New `references/oidc-integration.md` with full provider CRUD, identity mappings, per-CI claim recipes |
| `exchange-oidc-token` workflow | Listed only as a CLI command name | Documented end-to-end in `oidc-integration.md` with both setup-jfrog-cli and manual exchange paths |
| Project ↔ OIDC linkage | Conceptually unsupported | Mappings in the template directly bind claims to project-scoped groups via `applied-permissions/groups:<group>` |
| Bulk member onboarding | Required composing 3-4 endpoints by hand | Single `members[]` array in the template; apply script handles the orchestration |
| Group-first doctrine | Not stated | Stated in `projects-best-practices.md`; validate script warns when admins are users-only |
| Template / blueprint pattern | Absent | Three shipped blueprints + JSON Schema + customised output owned by the user |
| Verification helpers | Absent | `references/verification-and-idempotency.md` defines a five-check post-apply sweep |
| Customer archetypes (budget ID, delegated admin, zero-touch) | Absent | Two of three implemented as blueprints; zero-touch onboarding is the script-mode use case |
| Non-deterministic AI behaviour for project setup | Inherent risk | AI never mutates; the script is the authority. AI emits JSON, script applies it deterministically |

## Mapping to the seven-skill roadmap

| Roadmap item | Status |
| --- | --- |
| Project creation | **Done** as part of `jfrog-project-creation` (Phase 1) |
| Project identity and access configuration | **Done** as part of `jfrog-project-creation` (Phase 2). Could be re-split into a post-creation skill if preferred — flagged for review |
| Project repository structure configuration | **Planned** as `jfrog-project-repo-structure` (Phases 3+4 plan ready) |
| Project CI/CD | Planned. Depends on the OIDC reference shipped in Phase 1+2; consumes the `oidc` block of the template |
| Project application creation | Planned. Will consume `apptrust-entities.md` (already exists) plus a new operations file |
| Project curation enablement | Planned. Curation entities exist in `xray-entities.md`; needs an operations file |
| Project unified policies | Planned. Will build on `release-lifecycle-entities.md` |

The shared template is the integration contract:

```mermaid
flowchart LR
    Tpl["Project template<br/>(JSON, user-owned)"] --> P12["Phase 1+2 fields<br/>project, admins, roles, members, oidc"]
    Tpl --> P34["Phase 3+4 fields<br/>stages, repositories, sharing"]
    Tpl --> Future["Future: applications,<br/>curation, policies"]
    P12 --> Sk1["jfrog-project-creation<br/>(this PR)"]
    P34 --> Sk2["jfrog-project-repo-structure<br/>(next)"]
    Future --> Sk3["jfrog-project-application<br/>jfrog-project-curation<br/>jfrog-project-policies"]
```

Each downstream skill consumes a slice of the same template, so no
information has to be re-collected from the user. This is how the seven
roadmap skills avoid overlap with each other and with the existing base
skill.

## Phase 3+4 plan (what comes next)

Drafted in parallel with Phase 1+2; not yet implemented. Same two-mode
design (interactive AI + deterministic script), same template-as-contract
model, same idempotency guarantees. The skill is intended to be **a
direct continuation** of `jfrog-project-creation`: it extends the same
JSON template the user wrote in Phase 1+2 with new top-level sections.

### Persona

Phase 1+2 is Platform-Admin work. Phase 3+4 is **Project Admin** work
per the official docs ("the Project Admin primarily manages this phase
once the Platform Admin has established the project"). The new skill
verifies caller permissions before proceeding and accepts either
Project-Admin or Platform-Admin rights.

### Phase 3 — repository and technology scoping

What the skill will collect from the Project Admin and apply:

- **Technology stacks.** Multi-select from the package types the project
  needs (Maven, npm, PyPI, Docker, Go, NuGet, Helm, etc.). Each tech
  gets its own repository set rather than reusing one global repo.
- **SDLC stages.** Defaults to `DEV`, `QA`, `PROD`, plus a recommended
  `External` stage for third-party packages. Project Admin can rename
  or add stages per their lifecycle.
- **4-part naming convention.** Every repository name is enforced as
  `<project_key>-<tech>-<maturity>-<locator>` (e.g.,
  `team-x-maven-dev-local`, `team-x-npm-prod-virtual`,
  `team-x-docker-external-remote`). The validator warns on convention
  violations and offers strict mode for CI gates.
- **Per-tech repo blueprint.** For each selected tech: one local
  repository per stage, one remote repository for the External stage
  (with the canonical upstream URL preconfigured per tech), and one
  virtual aggregator that resolves all of them.
- **Virtual aggregator with explicit ordering.** Resolution order is
  written deterministically as `prod → dev → external → smart-remotes`,
  matching the recommended best-practice order. The script never relies
  on insertion order — it always sets `repositories[]` explicitly.
- **External-stage RBAC pattern.** Developers get read+write on the
  External stage so they can pull and cache new third-party packages,
  and read-only on internal DEV/PROD so they cannot bypass the
  External flow with a manual upload. The skill updates the project's
  member roles to reflect this.

### Phase 4 — collaboration and sharing

What the skill will support:

- **Direct sharing (push).** Producer project marks its Prod local as
  Shared via the Access API. Consumer projects then add the shared repo
  to their virtual aggregator. Producer manages the lifecycle — if it
  deletes the repo, consumers lose access. Best for tightly-coupled
  internal sharing.
- **Smart Remote (pull).** Consumer creates a smart-remote repository
  pointing at the producer's URL. Cache lifetime is independent —
  consumer survives producer-side deletion. Best for stricter
  segregation or contractual independence between teams.
- **Read-only consumer rule.** Regardless of method, consumers must
  hold read-only permissions on the producer's assets. The script
  enforces this when it adds members to shared repos and refuses to
  apply a sharing entry that would grant write access cross-project.

### Files added

In the base skill:

- `skills/jfrog/references/projects-best-practices.md` extended with
  Phase 3+4 sections (Team / Tech / Maturity / Locator naming;
  External-stage pattern; sharing patterns; consumer-read-only rule).
  Alternatively, a separate `projects-best-practices-repos.md` if the
  combined file gets too long.
- `skills/jfrog/assets/project-templates/schema.json` extended with
  full validation for the `stages`, `repositories`, and `sharing`
  top-level sections. The slots are already reserved in the Phase 1+2
  schema, so this is non-breaking.
- The three shipped blueprints
  (`team-default.json`, `enterprise-budget-id.json`,
  `delegated-admin.json`) updated with sample Phase 3+4 structures
  matching their archetype:
  - `team-default` — Maven + npm DEV/PROD/External with a virtual
    aggregator per tech.
  - `enterprise-budget-id` — three-tier Curation/Central/Certified
    structure mapped to repository stages.
  - `delegated-admin` — minimal repo set with a clear self-service
    expansion pattern.

In a new workflow skill (`skills/jfrog-project-repo-structure/`):

- `SKILL.md` — workflow-role frontmatter, prereq on the base skill,
  description triggering on "set up repos for project X" and similar.
- `references/repo-structure-flow.md` — conversational walkthrough for
  Phase 3 (technology selection, stage selection, naming, aggregator).
- `references/sharing-patterns.md` — Phase 4 push vs pull decision
  guide, when to use each, role assignments.
- `references/naming-convention.md` — the 4-part naming rule with
  examples and the validator's diagnostic output.
- `scripts/jfrog-project-apply-repo-structure.sh` — idempotent applier
  for repos, virtual aggregators, and sharing config.
- `scripts/jfrog-project-validate-repo-structure.sh` — offline checks
  on naming, virtual ordering, External-stage RBAC consistency; with
  `--check-platform`, delegates to apply `--dry-run`.

### Template extensions (illustrative)

The Phase 1+2 template gains three new top-level sections:

```json
{
  "stages": ["DEV", "QA", "PROD", "External"],
  "repositories": [
    { "tech": "maven", "maturity": "dev",      "locator": "local"   },
    { "tech": "maven", "maturity": "prod",     "locator": "local"   },
    { "tech": "maven", "maturity": "external", "locator": "remote",
      "url": "https://repo.maven.apache.org/maven2/" },
    { "tech": "maven", "maturity": "all",      "locator": "virtual",
      "aggregates": ["prod", "dev", "external"],
      "resolution_order": ["prod", "dev", "external"] }
  ],
  "sharing": [
    { "role": "producer",
      "repository": "team-x-maven-prod-local",
      "consumer_projects": ["team-y", "team-z"] },
    { "role": "consumer", "via": "smart-remote",
      "from_project": "team-platform",
      "from_repository": "team-platform-maven-prod-local",
      "into_repository": "team-x-platform-maven-remote" }
  ]
}
```

### Idempotency contract (same model as Phase 1+2)

- Local / remote / virtual repos:
  `GET /artifactory/api/repositories/<key>`; 404 → PUT to create; 200
  with matching config → already_exists; 200 differs → PUT to update.
- Project assignment of a repo: `POST /artifactory/api/repositories/<key>`
  with `{"projectKey": "<key>"}` only when the existing config does not
  already point at the project.
- Sharing: GET current shares, compare against template, POST or
  DELETE only the difference. The script never deletes shares the
  template does not mention.

### What Phase 3+4 deliberately does not include

These are split into later workflow skills so each remains focused:

- **AppTrust applications and version linking** → planned
  `jfrog-project-application`.
- **CI/CD pipeline templates and OIDC handshake wiring** → planned
  `jfrog-project-cicd`. (The OIDC *config* lives in Phase 2; pipeline
  templates that use it live in this future skill.)
- **Curation indexing, policies, and dry-run analysis** → planned
  `jfrog-project-curation`.
- **Unified gates and lifecycle policies** → planned
  `jfrog-project-policies`.

### Risks specific to Phase 3+4

- **Sharing endpoint shape stability.** The cross-project share API
  has changed shape historically; verify against a current platform
  version before locking the script.
- **Action-vocabulary coupling.** The External-stage RBAC pattern relies
  on specific Artifactory action names (READ, ANNOTATE, DEPLOY,
  DELETE_OVERWRITE, etc.). The exact set varies by platform version —
  the script should fetch the live vocabulary rather than hard-code it.
- **Migration of existing repos.** Many users will have repos that
  predate this skill and don't follow the 4-part convention. Phase 3+4
  must handle "rename or accept-as-is" decisions gracefully and never
  delete or rename a repo without an explicit user instruction.

## Open questions to resolve with reviewers

1. **Skill collapsing.** Is it acceptable to bundle Phase 1+2 into one
   `jfrog-project-creation` skill, with "Project identity and access
   configuration" repurposed as a post-creation skill? Splitting them is
   possible but creates a clumsy mid-conversation skill switch.
2. **OIDC payload shape.** The identity-mapping payload
   (`/access/api/v1/oidc/<provider>/identity_mappings`) was assembled
   from the public docs. Before locking the apply script, run a live
   verification against a target platform version — the field names and
   the `priority` semantics have changed historically.
3. **Storage-quota blocking semantics.** The
   [Create a Project](https://docs.jfrog.com/projects/docs/create-a-project)
   doc says deployments are blocked at 100%; the
   [Setup Best Practices](https://docs.jfrog.com/projects/docs/projects-setup-best-practices)
   doc says quotas "do not block actions". The skill currently warns the
   user that behaviour may depend on platform version. Resolve which is
   authoritative and update the doctrine file.
4. **Custom-role action vocabulary.** The schema accepts CUSTOM roles
   with `actions[]` but does not enumerate the valid action names (the
   list varies by platform version). Consider shipping a fetch helper
   that pulls the live action vocabulary into the conversation when a
   user wants a custom role.
5. **Blueprint maintenance cadence.** The three blueprints will drift
   when JFrog publishes new best-practice guidance. Decide a review
   cadence and a versioning story (the schema already supports
   `template_version` major-version refusal).
6. **CI for the new skill.** The repo's
   [validate-release.yml](https://github.com/jfrog/jfrog-skills/blob/main/.github/workflows/validate-release.yml)
   only checks file presence. Worth adding (a) a `bash -n` syntax check
   on every script, (b) `jq -e .` on every JSON file, and (c) a
   blueprint-validates-against-schema check, before this lands upstream.

## How to share with reviewers

- This document — high-level rationale and reviewer-facing summary.
- The plan file at `.cursor/plans/project-creation-skill_*.plan.md` —
  detailed technical plan with todos.
- The diff of the local clone at
  `~/SourceCode/Projects-skills/jfrog-skills/` — every file added or
  changed, ready to PR upstream once the open questions above are
  resolved.

## Verification performed locally

- Bash syntax check (`bash -n`) on both new scripts: pass.
- `jq -e .` on the schema and all three blueprints: pass.
- `jfrog-project-validate-template.sh` against all three blueprints:
  pass.
- `jfrog-project-validate-template.sh` against a deliberately broken
  template: catches eight crafted errors with clear messages.
- Cursor lint check on every changed/added file: pass.
- All twelve plan todos completed.
