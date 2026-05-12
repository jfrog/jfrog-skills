# Project templates — Artifactory-backed source of truth

Where the AI fetches project JSON templates from, and how it falls back
when the org has not curated any. Treat this file as the single source
of truth for the discovery and fetch contract; both phase groups of
the `jfrog-project-setup` skill reference it rather than restating it.

## Why this exists

v1 of the project skills wrote a customised JSON template to the user's
local disk and treated that file as the contract between AI and apply
script. That violates two constraints:

- Skills are **stateless** — the agent cannot persist files locally.
- Orgs need a **shared source of truth** so the same template shape
  travels across users, sessions, and CI.

v2 stores templates in a dedicated Artifactory generic-local repository.
The agent fetches a template, customises it in memory through the
conversation, and pipes the result to the apply script via stdin. The
apply script is the only writer, and it writes only to the JFrog
Platform.

## Resolving the templates repo (in order)

The agent uses **the first answer it gets**:

1. **Environment variable.** If `JFROG_PROJECT_TEMPLATES_REPO` is set in
   the calling environment, use that as the repo key. Read it via the
   shell — do not assume any particular default.
2. **Convention.** Probe the conventional key
   `project-templates-generic-local`. If it exists, use it.
3. **Bundled fallback.** If neither resolves, the agent skips Artifactory
   and falls through to the three bundled blueprints shipped at
   `<base_skill_path>/assets/project-templates/`.

### Probe call (explicit)

```http
GET /artifactory/api/repositories/{repo_key}
Accept: application/json
```

Status interpretation:

| Status | Meaning | Agent action |
| --- | --- | --- |
| `200` | Repo exists, is reachable, caller can read it | Use this repo for the rest of the flow |
| `403` | Repo exists but caller cannot read it | Stop. Tell the user their token lacks read on `{repo_key}`. Do not silently fall back |
| `404` | Repo does not exist | Move to the next resolution step |
| `5xx` | Platform error | Stop. Surface the status; do not silently fall back |

The agent **must not** create the repository on the user's behalf. The
org's platform team owns the templates repo lifecycle.

## Fetching a starting template

Once a templates repo is resolved, the agent walks a three-tier fetch
chain inside that repo. It uses the first hit.

### Tier 1 — per-project template

```http
GET /artifactory/{repo_key}/{project_key}.json
Accept: application/json
```

Handles orgs that pre-commit a tailored template per project. Typical
use: a platform team curates `fin-1042.json` so that anyone running
`create project fin-1042` always lands on the same shape.

### Tier 2 — org default

```http
GET /artifactory/{repo_key}/default.json
Accept: application/json
```

Handles orgs that ship a single house template for "new project, use our
standard shape".

### Tier 3 — archetype

```http
GET /artifactory/{repo_key}/{archetype}.json
Accept: application/json
```

Where `{archetype}` is one of `team-default` or `delegated-admin`.
Handles orgs that copied the bundled blueprints into Artifactory
unchanged and let users pick which archetype fits. Orgs needing a
different archetype (e.g. budget-ID-as-key) author it directly in
the templates repo.

### Listing what is available

If the agent wants to enumerate templates (e.g. to ask the user which
archetype matches), it lists the folder:

```http
GET /artifactory/api/storage/{repo_key}
Accept: application/json
```

The response carries `.children[]` with `uri` and `folder` fields.
Filter to `folder: false` and `uri` ending in `.json`.

## Bundled fallback

If no Artifactory templates repo is resolved, or every tier above 404s,
the agent uses the two bundled blueprints shipped at
`<base_skill_path>/assets/project-templates/`:

- `team-default.json`
- `delegated-admin.json`

These are **read-only patterns**. The agent never edits them on disk and
never writes a customised copy back to the skill repo. They are present
in the skill purely so the flow works for orgs that have not yet stood
up a templates repo.

## Seeding the Artifactory templates repo (one-time setup)

Org platform teams stand up the templates repo once. The skill does not
do this for them. The recommended seed steps:

1. **Create the repo.**

   ```http
   PUT /artifactory/api/repositories/project-templates-generic-local
   Content-Type: application/json

   {
     "key": "project-templates-generic-local",
     "rclass": "local",
     "packageType": "generic",
     "description": "JFrog Project templates consumed by the jfrog-project-setup skill"
   }
   ```

2. **Upload starter templates.** The bundled blueprints are the
   canonical starting set. Upload them as-is and edit afterwards:

   ```sh
   jf rt u team-default.json    project-templates-generic-local/team-default.json
   jf rt u delegated-admin.json project-templates-generic-local/delegated-admin.json
   ```

   Or via the REST API:

   ```http
   PUT /artifactory/project-templates-generic-local/team-default.json
   Content-Type: application/json

   {"template_version": "1.0", "...": "..."}
   ```

3. **Optional — restrict write.** Give the platform team push and grant
   everyone else read-only. The skill only needs read.

## Audit trail (optional)

Some orgs want a record of every applied template in Artifactory rather
than in git. The apply script supports this as an opt-in pattern: it can
`PUT` the applied JSON to a sibling path after a successful apply.

```http
PUT /artifactory/{repo_key}/applied/{project_key}-{iso8601_timestamp}.json
Content-Type: application/json
```

This is **off by default**. The skill flow enables it only when the user
explicitly asks, or when the `--audit` flag is passed to the apply
script. The script never deletes anything from `applied/`.

## What the agent does not do

- Does not write any file to local disk between fetch and apply. The
  customised JSON lives in the agent's context window and is piped to
  the apply script via stdin.
- Does not create the templates repo. If the repo is missing and no env
  var override is set, the agent uses the bundled fallback.
- Does not infer endpoint shapes. Every call is one of the literal
  endpoints listed above; if the platform returns an unexpected status,
  the agent surfaces it verbatim rather than guessing.
- Does not cache. Each conversation re-resolves the repo and re-fetches
  the template. There is no local state to invalidate.

## Anti-patterns

- Hard-coding any specific server hostname in a template. Templates are
  server-portable; the apply script targets the resolved server.
- Embedding access tokens or any credential in a template. Templates
  describe project shape, not auth material.
- Editing a bundled blueprint in the skill repo to fit an org. Edit a
  copy in Artifactory instead — that is what the templates repo exists
  for.
