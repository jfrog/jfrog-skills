> **Status: review preview, not for merge.** This summary accompanies a stakeholder-review branch and is not part of the shipping documentation.

# Executive summary — JFrog Project Creation Skill (Phases 1 + 2)

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

A new workflow skill, `jfrog-project-creation`, runs an interactive AI
flow with the Platform Admin to customise one of three shipped
**blueprints** (team-default, enterprise-budget-id, delegated-admin)
into a JSON template that captures every Phase 1+2 decision: project
key, quota, admin privileges, custom roles, group-based membership, and
OIDC provider plus identity mappings for CI. The template is written to
the customer's own repository — they own it, version it, and can
diff it. A deterministic, idempotent shell script then applies the
template to the JFrog server. The same template can be re-run for
verification, copied and edited to onboard the next team, or invoked
from CI for fully automated provisioning.

## What ships now (Phase 1+2)

- **Doctrine references** — `projects-best-practices.md` (project entity
  decisions, group-first RBAC, archetype guidance, anti-patterns) and
  `oidc-integration.md` (provider config, identity mappings, claim
  recipes for GitHub Actions / GitLab / generic, manual token exchange).
- **Three template blueprints** — covering single-team projects, central
  IdP-managed enterprise projects keyed by budget ID, and
  delegated-admin (application-owner) projects, all conforming to a
  draft-07 JSON schema.
- **`jfrog-project-creation` workflow skill** — entry-point SKILL.md
  with two-mode design (interactive customisation vs. deterministic
  apply), a six-stage conversation flow, and a verification &
  idempotency contract.
- **Two scripts** —
  `jfrog-project-create-from-template.sh` (idempotent applier with
  read-before-write logic and structured outcome JSON) and
  `jfrog-project-validate-template.sh` (offline schema + semantic
  validation, optional dry-run platform check).

## What comes next (Phase 3+4)

- **Phase 3 — Repository structure.** Defines stages and the four-part
  `team-tech-maturity-locator` repository naming convention; introduces
  virtual aggregators per technology stack and RBAC by stage (External
  vs. internal stages).
- **Phase 4 — Sharing and consumption.** Direct project-to-project
  sharing for internal collaboration; Smart Remotes for read-only
  consumption between organisations; explicit read-only consumer rules.

The same template format extends to carry these sections; the same apply
script reconciles them with the same idempotency guarantees.

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

- Full design summary (this branch): `docs/design/jfrog-project-creation-phase-1-2.md`
- Code: `skills/jfrog-project-creation/` and
  `skills/jfrog/{references,assets}/`
- All Phase 1+2 decisions are visible as commits C1–C5 on the
  `design/project-creation-phase-1-2` branch.
