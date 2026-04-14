# Artifactory Operations

CLI commands for managing Artifactory resources. All commands use the `jf rt`
namespace. Run `jf rt --help` to discover subcommands not listed here.

## Repository management

Repositories are created from JSON templates. The workflow is:

1. Get a template: retrieve an existing repo config
   via `jf rt curl -XGET /api/repositories/<repo-key>` and modify it, or
   craft JSON manually.
   Note: `jf rt repo-template` is interactive and cannot be used by agents.
2. Create: `jf rt repo-create <template.json>`
3. Update: `jf rt repo-update <template.json>`
4. Delete: `jf rt repo-delete <repo-pattern> --quiet`

To list repositories, use: `jf rt curl -XGET /api/repositories`

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
jf rt curl -s -XPOST /api/search/aql \
  -H "Content-Type: text/plain" \
  -d 'items.find({
    "name":"<artifact-filename>",
    "path":"<directory/path/within/repo>"
  }).include("repo","path","name","size","sha256")'
```

Add `"repo":"<repo-name>"` to the criteria when the target repo is known, to
narrow the search further.

## Build info

### Publishing builds

- Collect env: `jf rt build-collect-env <name> <number>`
- Add git info: `jf rt build-add-git <name> <number>`
- Publish: `jf rt build-publish <name> <number>`
- Promote: `jf rt build-promote <name> <number> <target-repo>`
- Discard: `jf rt build-discard <name>`

### Retrieving build info

The build detail API (`GET /api/build/{name}/{number}`) returns 404 when the
build is stored in a non-default build-info repo or belongs to a JFrog
Project. **Always resolve the scope before calling the build API:**

1. If the user provided a project key or build-info repo, use it directly.
2. If you need to **list** build names or run numbers and you have a **project
   key**, follow [Listing builds when the project key is known](#listing-builds-when-the-project-key-is-known) (REST first — do not jump to AQL).
3. If the project key and build-info repo are still unknown, discover scope
   via AQL (see [Discovering build scope without a project key](#discovering-build-scope-without-a-project-key) below).
4. For **detail**, use a scoped detail GET — never call `GET /api/build/<name>/<number>` without `?project=` or `?buildRepo=` when the build requires it.

```bash
jf rt curl -s -XGET "/api/build/<name>/<number>?buildRepo=<repo>"
jf rt curl -s -XGET "/api/build/<name>/<number>?project=<key>"
```

Scope parameters:

- `?buildRepo=<build-info-repo>` — when the build info is stored in a
  non-default build-info repository (anything other than
  `artifactory-build-info`)
- `?project=<project-key>` — when the build belongs to a JFrog Project

### Listing builds when the project key is known

When you have a **project key**, use this REST sequence before AQL. It scopes
the server’s work and avoids **unscoped** listing pitfalls (see below).

1. **Build names** (one row per logical build):  
   `GET /api/build?project=<project-key>`  
   Response includes `builds[]` with `uri` (path suffix per name) and
   `lastStarted` (latest run for that name).

2. **Run numbers for one name**:  
   `GET /api/build/<name>?project=<project-key>`  
   Response uses the field **`buildsNumbers`** (exact spelling from the API);
   each entry has `uri` (e.g. `/33`) and `started`. The same number may appear
   more than once with different `started` values — do not assume uniqueness
   by number alone.

3. **Full build info** (unchanged):  
   `GET /api/build/<name>/<number>?project=<project-key>`

```bash
jf rt curl -s -XGET "/api/build?project=<project-key>"
jf rt curl -s -XGET "/api/build/<name>?project=<project-key>"
jf rt curl -s -XGET "/api/build/<name>/<number>?project=<project-key>"
```

### Discovering build scope without a project key

When the user has not provided the project key or build-info repo, discover
it via AQL. **Do not** use **unscoped** `GET /api/build` (no `?project=` or
`?buildRepo=`) to list all builds — it can time out on large instances with
thousands of builds.

Use AQL `builds.find()` instead. The builds domain **requires** `name`,
`number`, and `repo` in `.include()` for permission reasons — omitting `repo`
produces an error.

```bash
jf rt curl -s -XPOST /api/search/aql \
  -H "Content-Type: text/plain" \
  -d 'builds.find({"name":"<build-name>"}).include("name","number","repo").sort({"$desc":["number"]}).limit(10)'
```

The `build.repo` field in the response tells you which build-info repository
the build resides in. Use that value as the `buildRepo` parameter in the
detail GET.

### Repository listing vs build-info

`GET /api/repositories?project=<key>&type=buildinfo` may return an empty list
even when project-scoped build info exists (for example under a `*-build-info`
repository). Prefer the **build** endpoints above or AQL to discover builds;
do not treat an empty repository list as proof that no builds exist.

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

To get user details or update users, use `jf rt curl`:
```
jf rt curl -XGET /access/api/v2/users/<username>
```

## Replication

Replication configs use JSON templates.
Note: `jf rt replication-template` is interactive.

- Create: `jf rt replication-create <template.json>`
- Delete: `jf rt replication-delete <repo-key>`
