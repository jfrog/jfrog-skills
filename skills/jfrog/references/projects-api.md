# JFrog Projects API

**See also:** `references/platform-access-entities.md`.

Projects via Access API — no CLI; use `jf api` (base skill *Invoking platform
APIs with `jf api`*). Paths: `/access/api/...`, `/artifactory/api/...`.

## Authentication

`jf api` resolves credentials from active `jf config` — no manual token/`curl`.

## Projects

### List all projects

```bash
jf api /access/api/v1/projects
```

Returns project objects: `project_key`, `display_name`, `description`,
`admin_privileges`, `storage_quota_bytes`, etc.

### Get a single project

```bash
jf api /access/api/v1/projects/<project-key>
```

### Create a project

```bash
jf api /access/api/v1/projects \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "display_name": "My Project",
    "description": "Project description",
    "admin_privileges": {
      "manage_members": true,
      "manage_resources": true,
      "index_resources": true
    },
    "project_key": "myproj"
  }'
```

`project_key`: 2-32 lowercase alphanumeric (hyphens allowed, no leading/trailing hyphen).

### Update a project

```bash
jf api /access/api/v1/projects/<project-key> \
  -X PUT -H "Content-Type: application/json" \
  -d '{"display_name": "Updated Name", "description": "Updated description"}'
```

### Delete a project

```bash
jf api /access/api/v1/projects/<project-key> -X DELETE
```

## Members

### List project members (users)

```bash
jf api /access/api/v1/projects/<project-key>/users
```

Returns `{"members": [{"name": "<username>", "roles": ["<role-name>"]}]}`.

### Add a member

```bash
jf api /access/api/v1/projects/<project-key>/users/<username> \
  -X PUT -H "Content-Type: application/json" \
  -d '{"name": "<username>", "roles": ["Developer"]}'
```

### Remove a member

```bash
jf api /access/api/v1/projects/<project-key>/users/<username> -X DELETE
```

### List project groups

```bash
jf api /access/api/v1/projects/<project-key>/groups
```

Response may list groups under **`members`**, **`groups`**, or both (platform
version dependent; same shape as users: `name`, `roles`). Accept whichever key present.

### Add a group

```bash
jf api /access/api/v1/projects/<project-key>/groups/<group-name> \
  -X PUT -H "Content-Type: application/json" \
  -d '{"name": "<group-name>", "roles": ["Contributor"]}'
```

## Roles

### List project roles

```bash
jf api /access/api/v1/projects/<project-key>/roles
```

Returns role objects: `name`, `description`, `type`
(`PREDEFINED`, `ADMIN`, or `CUSTOM`), `environments` (e.g. `["DEV","PROD"]`),
`actions` (permission strings).

Predefined: Project Admin, Developer, Contributor, Viewer, Release Manager,
Security Manager, AppTrust Manager, Model Governor, Model Developer.

**Multi-project reports:** one call per `project_key` — roles differ by project.
See `references/platform-access-entities.md`.

### Create a custom role

```bash
jf api /access/api/v1/projects/<project-key>/roles \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "name": "QA Engineer",
    "description": "Read and annotate repos in DEV",
    "type": "CUSTOM",
    "environments": ["DEV"],
    "actions": ["READ_REPOSITORY", "ANNOTATE_REPOSITORY", "READ_BUILD"]
  }'
```

## Environments

**Global** and **project-scoped** environment concepts for RBAC and resource
grouping; see
[Environments (Administration)](https://docs.jfrog.com/administration/docs/environments)
and `references/platform-access-entities.md`.

### List environments (platform API)

```bash
jf api /access/api/v1/environments
```

Returns `[{"name": "DEV"}, {"name": "PROD"}, ...]` — platform environment list.

### Create an environment

```bash
jf api /access/api/v1/environments \
  -X POST -H "Content-Type: application/json" \
  -d '{"name": "STAGING"}'
```

Environment names uppercase by convention.

## Repository assignment

### Assign a repository to a project

Update repo configuration:

```bash
jf api /artifactory/api/repositories/<repo-key> \
  -X POST -H "Content-Type: application/json" \
  -d '{"projectKey": "<project-key>"}'
```

### List repositories for a project

`GET /artifactory/api/repositories` — optional combinable query params:

| Parameter | Values | Example |
|-----------|--------|---------|
| `project` | project key | `?project=myproj` |
| `type` | `local`, `remote`, `virtual` | `?type=local` |
| `packageType` | `docker`, `maven`, `npm`, etc. | `?packageType=docker` |

```bash
# All repos in a project
jf api "/artifactory/api/repositories?project=<project-key>"

# Only local Docker repos in a project
jf api "/artifactory/api/repositories?project=<project-key>&type=local&packageType=docker"

# All remote repos (no project filter)
jf api "/artifactory/api/repositories?type=remote"
```

Lite list: `key`, `type`, `packageType`, `url` per repo.
See `references/artifactory-api-gaps.md` for filter examples.

### Get repository detail

Full configuration (including `projectKey`, `description`, storage settings
absent from lite list):

```bash
jf api "/artifactory/api/repositories/<repo-key>"
```

For specific repo or short list — not for filtering large sets. Filter via query params above.

### Name-prefix heuristic (unreliable -- last resort)

Project-scoped repos often follow `<project-key>-*` naming, but API does **not**
enforce. Repos can belong without prefix, or carry prefix without belonging.
Prefer `?project=<project-key>`. Name-prefix only when `project` param unavailable
(e.g. older Artifactory).

## Common error responses

- **Empty members/groups**: no members → `{"members": []}`, not 404. Groups
  endpoint may use same `members` key; empty = `{"members": []}`. Check array,
  not status code alone.
- **Invalid project key on create**: 400 if `project_key` outside 2-32 chars,
  uppercase, or leading/trailing hyphens.
- **Project not found**: 404 with `{"errors": [{"message": "..."}]}`.
- **Insufficient permissions**: `jf api` exits 1 on non-2xx; stderr
  `[Warn] jf api: ... returned 403` when token lacks project/platform admin.
