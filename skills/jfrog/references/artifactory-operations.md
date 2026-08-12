# Artifactory Operations

CLI for Artifactory resources — `jf rt` namespace. Run `jf rt --help` for subcommands not listed here.

## Repository management

Repos from JSON templates:

1. Get template: existing config via
   `jf api /artifactory/api/repositories/<repo-key>`
   and modify, or craft JSON manually.
   Note: `jf rt repo-template` is interactive and cannot be used by agents.
2. Create: `jf rt repo-create <template.json>`
3. Update: `jf rt repo-update <template.json>`
4. Delete: `jf rt repo-delete <repo-pattern> --quiet`

List: `jf api /artifactory/api/repositories`

## File operations

- Upload: `jf rt upload <source> <target>`
- Download: `jf rt download <source> [target]`
- Search: `jf rt search <pattern>`
- Move: `jf rt move <source> <target>`
- Copy: `jf rt copy <source> <target>`
- Delete: `jf rt delete <pattern>`
- Set properties: `jf rt set-props <pattern> "key=value"`
- Delete properties: `jf rt delete-props <pattern> "key"`

### Searching across repositories

`jf rt search` expects `<repo>/<pattern>`. When repo unknown, agents often use
leading wildcard (`jf rt search "*/path/..."`) → unscoped AQL internally →
timeouts on large instances.

Use direct AQL with `name` and `path` — omitting `repo` searches all accessible
repos via indexed columns:

```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" \
  -d 'items.find({
    "name":"<artifact-filename>",
    "path":"<directory/path/within/repo>"
  }).include("repo","path","name","size","sha256")'
```

Add `"repo":"<repo-name>"` when target repo is known.

## Build info

**Project scoping:** `?project=<key>` on **every** build detail call. User key
→ use it; else `?project=default`. AQL: `"repo":"<project-key>-build-info"` or
`"repo":"artifactory-build-info"` for default.

**Server rule:** 404 on `?project=<key>` ≠ try another server. Resolved server
only; on failure report and stop. See `SKILL.md` § *Server selection rules*.

### Publishing builds

- Collect env: `jf rt build-collect-env <name> <number>`
- Add git info: `jf rt build-add-git <name> <number>`
- Publish: `jf rt build-publish <name> <number>`
- Promote: `jf rt build-promote <name> <number> <target-repo>`
- Discard: `jf rt build-discard <name>`

### Listing build names

**Do not use `GET /api/build`** — no pagination; times out on large instances.
Always AQL with `limit` and `offset`.

**All builds** (no project scope):

```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" \
  -d 'builds.find().include("name","number","repo","created").sort({"$desc":["created"]}).offset(0).limit(100)'
```

**Project-scoped** — filter by build-info repo
(`<project-key>-build-info`, or `artifactory-build-info` for default project):

```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" \
  -d 'builds.find({"repo":"<project-key>-build-info"}).include("name","number","repo","created").sort({"$desc":["created"]}).offset(0).limit(100)'
```

**Pagination:** `range.total` vs `limit` → if exceeded, tell user: *"Showing
first 100 of N results (paginated). Ask for the next batch if needed."*
Increment `offset` by 100 per page.

**Output rule (mandatory):** AQL = one row per name+number. Extract **unique
build names** client-side (e.g. `jq '[.results[].builds.name] | unique'`). Present
**only deduplicated names** — no numbers, timestamps, run counts, or per-run
details (not even "bonus"/"most recent" table). Run details only if explicitly requested.

### Listing runs of a specific build

```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" \
  -d 'builds.find({"name":"<build-name>"}).include("name","number","repo","created").sort({"$desc":["created"]}).offset(0).limit(100)'
```

Add `"repo":"<project-key>-build-info"` when project key known. Same pagination rules.

### Retrieving full build info

REST detail endpoint for a **single** run. Always include `?project=<key>`
(or `?project=default` when no key):

```bash
jf api "/artifactory/api/build/<name>/<number>?project=<key>"
```

Only `/api/build` endpoint to use — single record, no pagination.

### When a build is not found

404 on detail call → build likely in different project. **Ask user for project
key** — do not search across repos or servers.

### Repository listing vs build-info

`GET /artifactory/api/repositories?project=<key>&type=buildinfo` may return
empty list even when project-scoped build info exists (e.g. under `*-build-info`).
Prefer AQL to discover builds; empty repository list ≠ no builds.

## Permissions

Permission targets use JSON templates.
Note: `jf rt permission-target-template` is interactive.

- Create: `jf rt permission-target-create <template.json>`
- Update: `jf rt permission-target-update <template.json>`
- Delete: `jf rt permission-target-delete <name>`

## Users and groups

- Create users: `jf rt users-create --csv <file>`
- Create single user: `jf rt user-create` (check `--help` for options)
- Delete users: `jf rt users-delete <pattern>`
- Create group: `jf rt group-create <name>`
- Delete group: `jf rt group-delete <name>`
- Add users to group: `jf rt group-add-users <group> <users-list>`

User details/update via `jf api`:
```
jf api /access/api/v2/users/<username>
```

## Replication

Replication configs use JSON templates.
Note: `jf rt replication-template` is interactive.

- Create: `jf rt replication-create <template.json>`
- Delete: `jf rt replication-delete <repo-key>`
