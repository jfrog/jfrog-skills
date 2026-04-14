# Platform Administration Operations

CLI and REST commands for platform-wide administration: access tokens, login,
stats, projects, and system health.

## Access tokens

```bash
jf access-token-create [username] [options]
```

Key options: `--groups`, `--scope`, `--expiry`, `--refreshable`, `--description`.

## Login

For login, see `references/jfrog-login-flow.md`.

## Stats

```bash
jf stats rt [--server-id <id>] [--format json|table]
```

## Projects

Projects are managed via the Access API (no CLI support). Use Tier 3
credentials (plain curl with extracted token):

```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh)" && \
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" "$JFROG_URL/access/api/v1/projects"
```

- **List projects**: `GET /access/api/v1/projects`
- **Get project**: `GET /access/api/v1/projects/<project-key>`
- **List members**: `GET /access/api/v1/projects/<project-key>/users`
- **List groups**: `GET /access/api/v1/projects/<project-key>/groups`
- **List roles**: `GET /access/api/v1/projects/<project-key>/roles`
- **List environments**: `GET /access/api/v1/environments`

When querying multiple projects, batch the calls in a single Shell invocation
to avoid per-project round-trips:

```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh)" && \
for proj in proj1 proj2 proj3; do
  curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
    "$JFROG_URL/access/api/v1/projects/$proj/users"
done
```

Read `references/projects-api.md` for detailed endpoint patterns including
creating/updating projects, managing members, and assigning repositories.

## System health

Not available in CLI. Use:
```bash
jf rt curl -XGET /api/system/ping
```
