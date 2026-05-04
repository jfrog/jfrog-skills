# Artifactory Operations

CLI commands for managing Artifactory resources. All commands use the `jf rt`
namespace. Run `jf rt --help` to discover subcommands not listed here.

## Repository management

Repositories are created from JSON templates. The workflow is:

1. Get a template: retrieve an existing repo config via
   `jf api /artifactory/api/repositories/<repo-key>`
   and modify it, or craft JSON manually.
   Note: `jf rt repo-template` is interactive and cannot be used by agents.
2. Create: `jf rt repo-create <template.json>`
3. Update: `jf rt repo-update <template.json>`
4. Delete: `jf rt repo-delete <repo-pattern> --quiet`

To list repositories, use:
`jf api /artifactory/api/repositories`

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

`jf rt search` expects a `<repo>/<pattern>` argument. When the repo is unknown,
agents tend to use a leading wildcard (`jf rt search "*/path/..."`), which
generates an unscoped AQL internally and can time out on large instances.

Use a direct AQL query with `name` and `path` criteria instead — omitting the
`repo` field searches all accessible repos via indexed columns:

```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" \
  -d 'items.find({
    "name":"<artifact-filename>",
    "path":"<directory/path/within/repo>"
  }).include("repo","path","name","size","sha256")'
```

Add `"repo":"<repo-name>"` to the criteria when the target repo is known, to
narrow the search further.

## Build info

**Project scoping rule:** Append `?project=<key>` to **every** build detail
API call. When the user provides a project key, use it. When no project key
is provided, use `?project=default` (the built-in default project that covers
the `artifactory-build-info` repo). For AQL queries, scope by
`"repo":"<project-key>-build-info"` (or `"repo":"artifactory-build-info"` for
the default project).

**Server rule:** A 404 from a `?project=<key>` build call is **not** a signal
to try a different server. Use only the resolved server; on any failure,
report and stop. See `SKILL.md` § *Server selection rules*.

### Publishing builds

- Collect env: `jf rt build-collect-env <name> <number>`
- Add git info: `jf rt build-add-git <name> <number>`
- Publish: `jf rt build-publish <name> <number>`
- Promote: `jf rt build-promote <name> <number> <target-repo>`
- Discard: `jf rt build-discard <name>`

### Listing build names

**Do not use `GET /api/build`** — it has no pagination and times out on large
instances. Always use AQL with `limit` and `offset`.

**All builds** (no project scope):

```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" \
  -d 'builds.find().include("name","number","repo","created").sort({"$desc":["created"]}).offset(0).limit(100)'
```

**Project-scoped** — filter by the project's build-info repository
(`<project-key>-build-info`, or `artifactory-build-info` for the default
project):

```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" \
  -d 'builds.find({"repo":"<project-key>-build-info"}).include("name","number","repo","created").sort({"$desc":["created"]}).offset(0).limit(100)'
```

**Pagination:** The response includes a `range` object with `total` (total
matching records). If `total` exceeds the `limit`, tell the user: *"Showing
first 100 of N results (paginated). Ask for the next batch if needed."*
For subsequent pages, increment `offset` by 100.

**Output rule (mandatory):** AQL returns one row per name+number pair.
Extract **unique build names** client-side (e.g.
`jq '[.[].builds.name] | unique'`). Present **only the deduplicated list of
build names** to the user. **Do not** include build numbers, timestamps, run
counts, or any per-run details in the response — not even as a "bonus" or
"most recent" table. The user is asking "what builds exist", not "what runs
happened". Only show run-level details if the user explicitly asks for them
in a follow-up.

### Listing runs of a specific build

```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" \
  -d 'builds.find({"name":"<build-name>"}).include("name","number","repo","created").sort({"$desc":["created"]}).offset(0).limit(100)'
```

Add `"repo":"<project-key>-build-info"` to the criteria when a project key
is known. Apply the same pagination rules as above.

### Retrieving full build info

Use the REST detail endpoint for a **single** build run. Always include
`?project=<key>` (or `?project=default` when no key is provided):

```bash
jf api "/artifactory/api/build/<name>/<number>?project=<key>"
```

This is the only `/api/build` endpoint that should be used — it returns a
single record and does not need pagination.

### When a build is not found

If the detail call returns 404, the build likely belongs to a different
project. **Ask the user for the project key** rather than searching across
repos or servers.

### Repository listing vs build-info

`GET /artifactory/api/repositories?project=<key>&type=buildinfo` may return
an empty list even when project-scoped build info exists (for example under
a `*-build-info` repository). Prefer AQL to
discover builds; do not treat an empty repository
list as proof that no
builds exist.

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

To get user details or update users, use `jf api`:
```
jf api /access/api/v2/users/<username>
```

## Replication

Replication configs use JSON templates.
Note: `jf rt replication-template` is interactive.

- Create: `jf rt replication-create <template.json>`
- Delete: `jf rt replication-delete <repo-key>`
