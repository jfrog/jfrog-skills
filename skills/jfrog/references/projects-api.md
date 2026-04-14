# JFrog Projects API

**See also:** `references/platform-access-entities.md` for how Projects relate to
repositories, members, roles, and environments.

Projects are managed through the Access API. There is no CLI support — use
Tier 3 credentials (plain curl with extracted token via
`get-platform-credentials.sh`).

All endpoints below are relative to the JFrog Platform URL.

## Authentication

All calls in this file require `required_permissions: ["full_network"]` in the
Shell tool (see the Network permissions section in SKILL.md).

```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh [server-id])"
```

Then use `$JFROG_URL` and `$JFROG_ACCESS_TOKEN` in all requests.

## Projects

### List all projects

```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/projects"
```

Returns an array of project objects with `project_key`, `display_name`,
`description`, `admin_privileges`, `storage_quota_bytes`, etc.

### Get a single project

```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/projects/<project-key>"
```

### Create a project

```bash
curl -s -XPOST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/access/api/v1/projects" \
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

The `project_key` must be 2-32 lowercase alphanumeric characters (hyphens
allowed, no leading/trailing hyphen).

### Update a project

```bash
curl -s -XPUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/access/api/v1/projects/<project-key>" \
  -d '{"display_name": "Updated Name", "description": "Updated description"}'
```

### Delete a project

```bash
curl -s -XDELETE -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/projects/<project-key>"
```

## Members

### List project members (users)

```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/projects/<project-key>/users"
```

Returns `{"members": [{"name": "<username>", "roles": ["<role-name>"]}]}`.

### Add a member

```bash
curl -s -XPUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/access/api/v1/projects/<project-key>/users/<username>" \
  -d '{"name": "<username>", "roles": ["Developer"]}'
```

### Remove a member

```bash
curl -s -XDELETE -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/projects/<project-key>/users/<username>"
```

### List project groups

```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/projects/<project-key>/groups"
```

The response may list group entries under **`members`**, **`groups`**, or both,
depending on platform version (same general shape as users: `name` and
`roles`). Parsers should accept whichever key is present.

### Add a group

```bash
curl -s -XPUT -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/access/api/v1/projects/<project-key>/groups/<group-name>" \
  -d '{"name": "<group-name>", "roles": ["Contributor"]}'
```

## Roles

### List project roles

```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/projects/<project-key>/roles"
```

Returns an array of role objects. Each has `name`, `description`, `type`
(`PREDEFINED`, `ADMIN`, or `CUSTOM`), `environments` (e.g. `["DEV","PROD"]`),
and `actions` (permission strings).

Predefined roles: Project Admin, Developer, Contributor, Viewer, Release
Manager, Security Manager, AppTrust Manager, Model Governor, Model Developer.

**Multi-project reports:** Call this endpoint **once per `project_key`**. Custom
roles and definitions can differ by project; do not assume one project's role
list matches another. See `references/platform-access-entities.md`.

### Create a custom role

```bash
curl -s -XPOST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/access/api/v1/projects/<project-key>/roles" \
  -d '{
    "name": "QA Engineer",
    "description": "Read and annotate repos in DEV",
    "type": "CUSTOM",
    "environments": ["DEV"],
    "actions": ["READ_REPOSITORY", "ANNOTATE_REPOSITORY", "READ_BUILD"]
  }'
```

## Environments

The product supports **global** and **project-scoped** environment concepts for
RBAC and resource grouping; see
[Environments (Administration)](https://docs.jfrog.com/administration/docs/environments)
and `references/platform-access-entities.md`.

### List environments (platform API)

```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/environments"
```

Returns `[{"name": "DEV"}, {"name": "PROD"}, ...]` -- the platform environment
list available through this Access API path.

### Create an environment

```bash
curl -s -XPOST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/access/api/v1/environments" \
  -d '{"name": "STAGING"}'
```

Environment names are uppercase by convention.

## Repository assignment

### Assign a repository to a project

Assign a repository to a project by updating its configuration:

```bash
jf rt curl -XPOST "/api/repositories/<repo-key>" \
  -H "Content-Type: application/json" \
  -d '{"projectKey": "<project-key>"}'
```

### List repositories for a project

`GET /api/repositories` supports optional query parameters that can be combined:

| Parameter | Values | Example |
|-----------|--------|---------|
| `project` | project key | `?project=myproj` |
| `type` | `local`, `remote`, `virtual` | `?type=local` |
| `packageType` | `docker`, `maven`, `npm`, etc. | `?packageType=docker` |

```bash
# All repos in a project
jf rt curl -XGET "/api/repositories?project=<project-key>"

# Only local Docker repos in a project
jf rt curl -XGET "/api/repositories?project=<project-key>&type=local&packageType=docker"

# All remote repos (no project filter)
jf rt curl -XGET "/api/repositories?type=remote"
```

Returns a lite list with `key`, `type`, `packageType`, and `url` per repo.
See `references/artifactory-api-gaps.md` for additional filter examples.

### Get repository detail

To retrieve the full configuration of a specific repository (including fields
like `projectKey`, `description`, storage settings, etc. that are absent from
the lite list), use the detail endpoint:

```bash
jf rt curl -XGET "/api/repositories/<repo-key>"
```

Use this when you have a specific repo or a short list of repos to inspect --
not for filtering large sets. For filtering, use the query parameters above.

### Name-prefix heuristic (unreliable -- last resort)

Project-scoped repos often follow a `<project-key>-*` naming convention, but
the API does **not** enforce this. Repos can belong to a project without the
prefix, or carry the prefix without belonging. Always prefer
`?project=<project-key>` for authoritative results. Use name-prefix matching
only when the `project` query parameter is unavailable (e.g. older Artifactory
versions).

## Common error responses

- **Empty members/groups**: projects with no members return
  `{"members": []}`, not 404. The groups list endpoint may use the same
  `members` key for group entries; empty lists look like `{"members": []}`.
  Always check the array rather than the status code alone.
- **Invalid project key on create**: returns 400 if `project_key` is outside
  2-32 chars, contains uppercase letters, or has leading/trailing hyphens.
- **Project not found**: returns 404 with `{"errors": [{"message": "..."}]}`.
- **Insufficient permissions**: returns 403 if the token lacks project admin
  or platform admin privileges.
