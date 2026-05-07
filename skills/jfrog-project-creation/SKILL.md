---
name: jfrog-project-creation
version: "0.1.0"
description: >-
  Create a new JFrog Project end-to-end following JFrog's Projects Setup
  Best Practices (Phase 1: define the project entity; Phase 2: identity and
  access strategy). Picks one of three shipped blueprints (team-default,
  enterprise-budget-id, delegated-admin), customises it through a guided
  conversation, writes the customised JSON template to a path the user
  chooses, and applies it idempotently via a deterministic script. Use this
  skill when the user wants to set up a new project, onboard a team to
  JFrog, work with JFrog to manage workflow at scale, enforce permission
  isolation between teams, map their teams, applications, or microservices
  into JFrog when starting to use the platform, structure JFrog around an
  existing organisation, configure OIDC for a project, wire CI
  authentication via identity mappings, or bootstrap project members and
  roles. Also use when the user mentions scaling JFrog usage, multi-team
  setup, permission isolation, tenant separation, team mapping, mapping
  applications or microservices into JFrog, onboarding a team or app to
  JFrog, or starting out with JFrog at organisation scale. Do NOT use for
  repository structure, virtual aggregator setup, or sharing patterns --
  those are Phases 3+4 and are handled by jfrog-project-repo-structure.
metadata:
  role: workflow
---

# JFrog Project Creation (Phases 1+2)

## Prerequisites

- Read `../jfrog/SKILL.md` for JFrog Platform concepts, server selection rules,
  the `jf api` invocation pattern, network permissions, and cautious-execution
  rules. Every API call below runs through `jf api` with
  `required_permissions: ["full_network"]` on the Shell tool.
- The caller must be a **Platform Admin** on the resolved server. The script
  fails fast if the active token lacks platform-admin scope.
- Read `../jfrog/references/projects-best-practices.md` (Phase 1+2 doctrine
  and customer archetypes) before starting the conversation.
- Read `../jfrog/references/projects-api.md` for endpoint shapes (project
  CRUD, members, roles, environments).
- Read `../jfrog/references/oidc-integration.md` if the user wants to wire
  OIDC for CI as part of project creation.

## What this skill does and does not do

**Does:** define the project entity (key, display name, description,
quota, admin privileges, project admins); ensure project roles exist
(predefined references and CUSTOM creation); assign group/user members to
roles; create an OIDC provider and identity mappings that bind incoming CI
claims to project-scoped groups.

**Does not (handled by `jfrog-project-repo-structure`):** create
repositories, define stages beyond the platform default DEV/PROD, build
virtual aggregators, configure External-stage repos, or set up cross-project
sharing.

## Two-mode design

```mermaid
flowchart TD
    User[User: 'create my first project'] --> Skill[jfrog-project-creation]
    Skill --> Mode{Have a template already?}
    Mode -->|"no"| Interactive[Interactive AI flow:<br/>pick blueprint, customise, write template"]
    Mode -->|"yes"| Apply[Apply existing template]
    Interactive --> Template[Customised template JSON<br/>at user-chosen path]
    Template --> Apply
    Apply --> Script[scripts/jfrog-project-create-from-template.sh]
    Script --> Verify[Run verification helpers, summarise]
```

- **Interactive mode** — the agent walks the user through Phase 1+2
  questions, picks a blueprint, fills it in, and writes the customised JSON
  to a user-chosen path (typically inside the user's own repo so they can
  version-control it).
- **Script mode** — `scripts/jfrog-project-create-from-template.sh` applies
  the template idempotently. Standalone, non-interactive, runnable from CI.

The agent **must** drop into script mode for the actual mutations. Do not
issue create/update API calls directly from the conversation: the script is
the authoritative applier, and it carries the GET-before-write idempotency
logic.

## Mandatory entry steps

Before any conversation about project shape, run these steps in order:

1. **Resolve the target server** per the base SKILL.md *Server selection
   rules*. Do not silently pick a default; if the user did not name a
   server and there is more than one, ask. Capture the resolved server-id
   for use in every later call.
2. **Run the environment check** if not already done in this session
   (`<skill_path>/scripts/check-environment.sh`).
3. **Verify caller has platform-admin scope** by reading
   `jf api /access/api/v1/system/permissions` (or, as a lightweight
   alternative, attempting `jf api /access/api/v1/projects` and checking
   for 200; 403 means insufficient privileges). Stop and report if
   insufficient — do not proceed and do not fall back to a different
   server.
4. **Fetch the existing project list** so the conversation can avoid
   colliding on `project_key`. Save to a temp file per the base SKILL.md
   *Preserving command output* pattern.

## Workflow

The full conversational walkthrough — blueprint pick, Phase 1 questions,
Phase 2 questions, preview, write, apply, verify — lives in
`references/creation-flow.md`. Read it whenever the user asks to start a
new project.

### Brief outline

1. Ask which archetype best fits — present the three blueprints with
   one-line summaries from `references/creation-flow.md`.
2. Phase 1 questions: project key (validate against the regex from
   `../jfrog/references/projects-api.md`), display name, description,
   quota in GB (or Unlimited), `admin_privileges` flags, Project Admin
   groups.
3. Phase 2 questions: which predefined roles to enable; any custom roles;
   group → role bindings; whether to wire OIDC and (if yes) provider
   details + identity-mapping claim filters.
4. Show the customised JSON template. Confirm with the user before any
   mutation — this is a *cautious-execution* gate per the base SKILL.md.
5. Write the template to the path the user names (default suggestion:
   `./projects/<project-key>.json` inside the user's repo).
6. Invoke `scripts/jfrog-project-create-from-template.sh <path>`.
7. Run the post-apply checks from
   `references/verification-and-idempotency.md` and report the outcome.

## Reference files

Load these only when the situation calls for them. Avoid loading more than
2-3 in a single conversation turn.

- `references/creation-flow.md` — the full Phase 1+2 conversational flow
  and the per-blueprint customisation prompts.
- `references/verification-and-idempotency.md` — post-apply checks plus
  the idempotency contract the apply script implements.
- `../jfrog/references/projects-best-practices.md` — Phase 1+2 doctrine,
  archetype definitions, anti-patterns.
- `../jfrog/references/projects-api.md` — endpoint shapes for project CRUD,
  members, roles, environments.
- `../jfrog/references/oidc-integration.md` — provider config and identity
  mappings (read when the user wants OIDC).
- `../jfrog/references/platform-access-entities.md` — entity model and
  agent rules (read when explaining roles vs environments vs groups).

## Blueprints

Three blueprints ship with the base skill at
`<base_skill_path>/assets/project-templates/`:

- `team-default.json` — single team, default settings, OIDC optional.
- `enterprise-budget-id.json` — project key tied to an immutable budget
  identifier; central IdP membership; OIDC required.
- `delegated-admin.json` — heavy delegation to application owners;
  groups-only membership; OIDC required.

The schema for these files lives at
`<base_skill_path>/assets/project-templates/schema.json` and is what the
validate script enforces.

## Scripts

Both scripts are non-interactive and emit structured JSON outcome reports.

- `scripts/jfrog-project-create-from-template.sh <template.json> [--server-id <id>]`
  — apply the template idempotently. GET-before-PUT/POST per resource.
- `scripts/jfrog-project-validate-template.sh <template.json> [--server-id <id>]`
  — schema validation plus dry-run lookups for referenced groups, users,
  and OIDC providers.

Run validate before apply when the user is uncertain. Re-running apply
after a partial failure is safe.

## Gotchas

- **`project_key` is immutable.** The script will refuse to update a key
  that differs from an existing project's. Confirm before writing the
  template.
- **Predefined roles do not need creating.** The schema accepts
  `type: PREDEFINED` so the template can describe the project's role
  surface, but the script does not call `POST /roles` for predefined
  entries — it skips them and moves on to member assignment.
- **Membership is groups-first.** Templates that list users without groups
  will pass validation but the agent should warn the user during the
  walkthrough.
- **OIDC provider is platform-scoped.** Two projects sharing the same
  GitHub org typically share one provider; the script checks for an
  existing provider with the same name before creating, and adds new
  identity mappings non-destructively.
- **Storage quota at 100% may block deployments.** Surface this when
  setting `quota_gb`. Quotas are editable later; project keys are not.
- **Cross-call shell PIDs differ.** Save and echo temp file paths per
  the base SKILL.md *Preserving command output* pattern when handing
  state between Shell calls.
- **Test data hygiene.** Every example, comment, and prompt in this skill
  uses generic placeholder names (`mycompany.jfrog.io`, `team-x`,
  `app-04217`, `fin-1042`). Do not introduce real customer or internal
  names.

## Out of scope (handled by future workflow skills)

- Repository structure, naming convention enforcement, virtual aggregators,
  External-stage pattern → `jfrog-project-repo-structure` (Phases 3+4).
- CI/CD pipeline templates beyond the OIDC handshake → planned
  `jfrog-project-cicd`.
- AppTrust application creation and version linking → planned
  `jfrog-project-application`.
- Curation indexing, policy creation, dry-run → planned
  `jfrog-project-curation`.
- Unified gates and lifecycle policies → planned `jfrog-project-policies`.
