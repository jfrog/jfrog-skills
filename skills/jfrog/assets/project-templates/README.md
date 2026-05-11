# Bundled project-template blueprints

**Last-resort fallbacks.** The agent prefers a template fetched
from the org's Artifactory templates repository and falls back to
these blueprints only when no Artifactory templates repo is
configured or every tier in the fetch chain returns 404.

See
[`../../references/project-templates-artifactory-repo.md`](../../references/project-templates-artifactory-repo.md)
for the full discovery contract, fetch chain, seeding instructions,
and fallback diagram.

## Contents

- `schema.json` — JSON Schema (draft-07) every template must
  satisfy, used by the validate scripts in both workflow skills.
- `team-default.json` — single team, one workspace; OIDC optional;
  predefined roles. Smallest archetype.
- `enterprise-budget-id.json` — project key tied to an immutable
  budget identifier; central IdP holds membership; OIDC required;
  three-tier role split.
- `delegated-admin.json` — heavy delegation to application owners;
  groups-only membership; OIDC required.

The agent never edits these files on disk and never writes a
customised copy back to this directory. Orgs that want to customise
the archetypes should copy them into their Artifactory templates
repo and edit the copies there.
