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

Projects are managed via the Access API (no CLI subcommand). Invoke the
endpoints through `jf api` (see the base skill's *Invoking platform APIs
with `jf api`* section). Authentication is handled automatically:

```bash
jf api /access/api/v1/projects
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
for proj in proj1 proj2 proj3; do
  jf api "/access/api/v1/projects/$proj/users"
done
```

Read `references/projects-api.md` for detailed endpoint patterns including
creating/updating projects, managing members, and assigning repositories.

## System health

Not available as a dedicated CLI subcommand. Use:
```bash
jf api /artifactory/api/system/ping
```
