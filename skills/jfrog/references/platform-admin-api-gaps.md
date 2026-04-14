# Platform Administration API Gaps

Operations available through REST API but not (or only partially) through CLI.
For Artifactory-scoped endpoints, use `jf rt curl`.
For platform-wide endpoints, use plain `curl` with credentials from
`scripts/get-platform-credentials.sh`.

## Users (full CRUD)

The CLI has `users-create` and `users-delete` but lacks GET and UPDATE.

### Get user details
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v2/users/<username>"
```

### List users
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v2/users/"
```

### Update user (partial)
```bash
curl -s -XPATCH -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/access/api/v2/users/<username>" \
  -d '{"email": "newemail@example.com"}'
```

### Create user
```bash
curl -s -XPOST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/access/api/v2/users/" \
  -d '{"username": "newuser", "email": "user@example.com", "password": "...", "admin": false}'
```

## Groups (full CRUD)

### Get group details
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v2/groups/<groupname>"
```

### List groups
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v2/groups/"
```

## Permissions (full CRUD)

### List permissions
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v2/permissions/"
```

### Get permission details
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v2/permissions/<permission-name>"
```

## Access tokens (beyond CLI)

The CLI has `access-token-create` but not list or revoke.

### List tokens
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/tokens"
```

### Revoke token by ID
```bash
curl -s -XDELETE -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/tokens/<token-id>"
```

## Environments

### List global environments
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/environments"
```

### Create global environment
```bash
curl -s -XPOST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/access/api/v1/environments" \
  -d '{"name": "STAGING"}'
```

## Projects

See `references/projects-api.md` for full project CRUD, members, roles, and
environments.

## Webhooks

### List webhooks
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/webhooks"
```

### Create webhook
```bash
curl -s -XPOST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/access/api/v1/webhooks" \
  -d '{"key": "my-webhook", "url": "https://example.com/hook", "event_types": ["uploaded"]}'
```

## System health

### Platform ping
```bash
jf rt curl -XGET /api/system/ping
```

### Artifactory version
```bash
jf rt curl -XGET /api/system/version
```

### Xray ping
```bash
jf xr curl -XGET /api/v1/system/ping
```

### Xray version
```bash
jf xr curl -XGET /api/v1/system/version
```

## OIDC configuration

### List OIDC providers
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/oidc"
```

### Create OIDC configuration
```bash
curl -s -XPOST -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "$JFROG_URL/access/api/v1/oidc" \
  -d '{"name": "my-oidc", "issuer_url": "https://...", "provider_type": "generic"}'
```

## SCIM (user provisioning)

### Get SCIM users
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/scim/v2/Users"
```

## Workers (beyond CLI)

The CLI covers most worker operations. These are API-only:

### Get available actions
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/worker/api/v1/actions"
```

### Get actions metadata
```bash
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/worker/api/v1/actions/metadata"
```
