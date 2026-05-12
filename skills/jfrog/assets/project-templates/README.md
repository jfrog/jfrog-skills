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
  satisfy. Read by the `jfrog-project-setup` apply scripts and
  usable out-of-band with `ajv` for offline linting of
  org-authored templates.
- `team-default.json` — single team, one workspace, OIDC optional,
  predefined roles. The bundled archetype.

The agent never edits these files on disk and never writes a
customised copy back to this directory. Orgs that want a different
shape (delegated admin, budget-ID-as-key, enterprise governance)
author the variant directly in their Artifactory templates repo.
