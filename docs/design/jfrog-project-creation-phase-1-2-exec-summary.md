> **Status: review preview, not for merge.** This summary accompanies a stakeholder-review branch and is not part of the shipping documentation.

# Executive summary — JFrog Project Creation Skill (Phases 1 + 2 + 3 + 4)

## Why now

JFrog Skills today gives AI agents a strong foundation for package safety
and platform interaction, but **provides no opinionated path for setting
up a JFrog Project**. Customers fall back to free-form chats with the
agent, which produces inconsistent project shapes across teams: drifted
naming conventions, ad-hoc role definitions, manually wired OIDC, and no
audit trail. Onboarding a new team takes days of repeated platform-admin
attention; replicating the same shape across many teams is a manual
copy-and-pray exercise.

## Approach in one paragraph

Two stacked workflow skills work against a single JSON template the
customer owns and version-controls. **`jfrog-project-creation`**
(Phases 1+2) runs an interactive AI flow with the Platform Admin to
customise one of three shipped **blueprints** (team-default,
enterprise-budget-id, delegated-admin) into a template that captures
the project key, quota, admin privileges, custom roles, group-based
membership, and OIDC provider plus identity mappings for CI.
**`jfrog-project-repo-structure`** (Phases 3+4) extends the same
template with SDLC stages, the four-part repository naming
convention, virtual aggregators with explicit resolution order,
External-stage RBAC, and cross-project sharing (push or pull).
Deterministic, idempotent shell scripts then apply each phase to the
JFrog server. The same template can be re-run for verification,
copied and edited to onboard the next team, or invoked from CI for
fully automated provisioning.

## What ships now (Phases 1+2+3+4)

- **Doctrine references** —
  `projects-best-practices.md` (project entity decisions, group-first
  RBAC, archetype guidance, anti-patterns),
  `projects-best-practices-repos.md` (four-part naming, SDLC stages,
  per-tech repo blueprint, virtual-aggregator ordering, External-stage
  RBAC, push vs pull sharing, read-only-consumer rule), and
  `oidc-integration.md` (provider config, identity mappings, claim
  recipes for GitHub Actions / GitLab / generic, manual token exchange).
- **Three template blueprints** — covering single-team projects,
  central IdP-managed enterprise projects keyed by budget ID, and
  delegated-admin (application-owner) projects, all conforming to a
  draft-07 JSON schema. Each blueprint now ships archetype-sized
  Phase 3+4 sections (stages, repositories, External-stage RBAC,
  optional sharing).
- **Two stacked workflow skills** —
  `jfrog-project-creation` (Phases 1+2, Platform-Admin persona) and
  `jfrog-project-repo-structure` (Phases 3+4, Project-Admin
  persona). Both follow the same two-mode design (interactive
  customisation vs. deterministic apply), share the same template
  format, and use the same idempotency contract.
- **Four scripts** —
  `jfrog-project-create-from-template.sh` and
  `jfrog-project-validate-template.sh` (Phase 1+2);
  `jfrog-project-apply-repo-structure.sh` (idempotent reconciliation
  for stages, locals/remotes/virtuals with project-assignment guards,
  External-stage RBAC overlay, and producer/consumer/smart-remote
  sharing with read-only-consumer enforcement) and
  `jfrog-project-validate-repo-structure.sh` (offline structural
  validation with optional `ajv` schema check and `--check-platform`
  dry-run delegation).

## What comes next

- **`jfrog-project-cicd`** — pipeline templates and OIDC handshake
  wiring that consumes the `oidc` block of the template (the OIDC
  config landed in Phase 2; pipeline templates that use it land here).
- **`jfrog-project-application`** — AppTrust application creation and
  version linking against an existing project.
- **`jfrog-project-curation`** — curation indexing, policy creation,
  and dry-run analysis on the External stage.
- **`jfrog-project-policies`** — unified gates and lifecycle policies
  on top of the repo structure.

## Outcome

- Onboarding a project shifts from a multi-day, free-form chat to a
  reviewable JSON file plus a one-command apply.
- Replicating the same project shape across N teams becomes a
  copy-and-edit operation, not a fresh design conversation.
- Templates can be committed to the customer's own repository, giving a
  full audit trail of who provisioned what and when.
- CI pipelines can self-onboard their own projects against the same
  template with no platform-admin intervention.

## Risks and open questions for reviewers

- **Skill scoping.** The roadmap lists "project creation" and "project
  identity and access" as separate skills. The implementation collapses
  them into one workflow because they share the same conversation,
  template, and apply script. Reviewers should confirm whether to keep
  them merged or split before public release.
- **Drift detection cadence.** The apply script is idempotent, but
  there's no scheduled drift report yet. Decision: leave to CI pipelines
  the customer owns, or ship a `jfrog-project-diff-template.sh`
  helper?
- **OIDC provider naming.** Blueprints suggest provider names like
  `gh-actions-acme`. We may want to harden this into a documented
  convention before the wider rollout.
- **Template ownership boundary.** Today the skill ships blueprints, the
  customer owns emitted templates. Confirm we don't want a JFrog-hosted
  template registry for centrally managed conventions.

## Where to read more

- Full design summary (this branch):
  `docs/design/jfrog-project-creation-phase-1-2.md`. Filename is kept
  stable; the document now covers Phases 1+2+3+4.
- Code: `skills/jfrog-project-creation/`,
  `skills/jfrog-project-repo-structure/`, and
  `skills/jfrog/{references,assets}/`.
- All Phase 1+2 decisions are visible as commits C1–C5 (plus a C6
  description refinement) on the
  `design/project-creation-phase-1-2` branch.
- All Phase 3+4 decisions are visible as commits C1–C5 on the stacked
  branch `design/project-repo-structure` (off
  `design/project-creation-phase-1-2`). Both branches are local-only
  until you decide to publish.
