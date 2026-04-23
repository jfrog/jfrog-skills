# Platform Administration API Gaps

Operations available through REST API but not (or only partially) through the
CLI. Invoke all of them via `jf api` (see the base skill's *Invoking platform
APIs with `jf api`* section). Authentication is handled automatically from
the configured `jf` server — no token extraction needed. Every path includes
the product prefix (`/access/...`, `/artifactory/...`, `/xray/...`,
`/worker/...`).

## Users (full CRUD)

The CLI has `users-create` and `users-delete` but lacks GET and UPDATE.

### Get user details
```bash
jf api /access/api/v2/users/<username>
```

### List users
```bash
jf api /access/api/v2/users/
```

### Update user (partial)
```bash
jf api /access/api/v2/users/<username> \
  -X PATCH -H "Content-Type: application/json" \
  -d '{"email": "newemail@example.com"}'
```

### Create user
```bash
jf api /access/api/v2/users/ \
  -X POST -H "Content-Type: application/json" \
  -d '{"username": "newuser", "email": "user@example.com", "password": "...", "admin": false}'
```

## Groups (full CRUD)

### Get group details
```bash
jf api /access/api/v2/groups/<groupname>
```

### List groups
```bash
jf api /access/api/v2/groups/
```

## Permissions (full CRUD)

### List permissions
```bash
jf api /access/api/v2/permissions/
```

### Get permission details
```bash
jf api /access/api/v2/permissions/<permission-name>
```

## Access tokens (beyond CLI)

The CLI has `access-token-create` but not list or revoke.

### List tokens
```bash
jf api /access/api/v1/tokens
```

### Revoke token by ID
```bash
jf api /access/api/v1/tokens/<token-id> -X DELETE
```

## Environments

### List global environments
```bash
jf api /access/api/v1/environments
```

### Create global environment
```bash
jf api /access/api/v1/environments \
  -X POST -H "Content-Type: application/json" \
  -d '{"name": "STAGING"}'
```

## Projects

See `references/projects-api.md` for full project CRUD, members, roles, and
environments.

## Webhooks

### List webhooks
```bash
jf api /access/api/v1/webhooks
```

### Create webhook
```bash
jf api /access/api/v1/webhooks \
  -X POST -H "Content-Type: application/json" \
  -d '{"key": "my-webhook", "url": "https://example.com/hook", "event_types": ["uploaded"]}'
```

## System health

### Platform ping
```bash
jf api /artifactory/api/system/ping
```

### Artifactory version
```bash
jf api /artifactory/api/system/version
```

### Xray ping
```bash
jf api /xray/api/v1/system/ping
```

### Xray version
```bash
jf api /xray/api/v1/system/version
```

## OIDC configuration

### List OIDC providers
```bash
jf api /access/api/v1/oidc
```

### Create OIDC configuration
```bash
jf api /access/api/v1/oidc \
  -X POST -H "Content-Type: application/json" \
  -d '{"name": "my-oidc", "issuer_url": "https://...", "provider_type": "generic"}'
```

## SCIM (user provisioning)

### Get SCIM users
```bash
jf api /access/api/v1/scim/v2/Users
```

## Workers (beyond CLI)

The CLI covers most worker operations. These are API-only:

### Get available actions
```bash
jf api /worker/api/v1/actions
```

### Get actions metadata
```bash
jf api /worker/api/v1/actions/metadata
```
