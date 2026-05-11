# OIDC integration

Read this file to configure an OpenID Connect provider on the JFrog
Platform, wire a CI system (GitHub Actions, GitLab CI, generic
OIDC) to authenticate without static credentials, or use
`jf exchange-oidc-token` (alias `jf eot`) inside a CI job.

For the conceptual role of OIDC inside a project's identity
strategy, see
[`projects-best-practices.md`](projects-best-practices.md) §"OIDC
for CI authentication". For project-side member/role wiring, see
[`projects-api.md`](projects-api.md).

All endpoints run through `jf api` and require
`required_permissions: ["full_network"]` in the Shell tool. Provider
and identity-mapping management requires platform-admin permissions
on the resolved server.

Source: [OpenID Connect Integration](https://docs.jfrog.com/administration/docs/openid-connect-integration).

## Endpoints

Two-layer model: one **provider** per external issuer; one or more
**identity mappings** per provider. The provider is platform-scoped;
the mapping's `token_spec.scope` is how OIDC reaches a specific
project.

| Operation                  | Method  | Path                                                                     |
| -------------------------- | ------- | ------------------------------------------------------------------------ |
| List providers             | GET     | `/access/api/v1/oidc`                                                    |
| Get provider               | GET     | `/access/api/v1/oidc/<provider>`                                         |
| Create provider            | POST    | `/access/api/v1/oidc`                                                    |
| Update provider            | PUT     | `/access/api/v1/oidc/<provider>`                                         |
| Delete provider (cascades) | DELETE  | `/access/api/v1/oidc/<provider>`                                         |
| List mappings              | GET     | `/access/api/v1/oidc/<provider>/identity_mappings`                       |
| Get mapping                | GET     | `/access/api/v1/oidc/<provider>/identity_mappings/<mapping>`             |
| Create mapping             | POST    | `/access/api/v1/oidc/<provider>/identity_mappings`                       |
| Update mapping             | PUT     | `/access/api/v1/oidc/<provider>/identity_mappings/<mapping>`             |
| Delete mapping             | DELETE  | `/access/api/v1/oidc/<provider>/identity_mappings/<mapping>`             |
| List issued tokens         | GET     | `/access/api/v1/tokens`                                                  |
| Revoke a token             | DELETE  | `/access/api/v1/tokens/<token-id>`                                       |

Provider `provider_type`: `github`, `gitlab`, or `generic` (and
others added over time — call `GET /access/api/v1/oidc` on the
target server to confirm).

Deleting a provider deletes its mappings. There is no undo.

## Identity mapping anatomy

```json
{
  "name": "main-branch-publish",
  "priority": 100,
  "claims": {
    "repository": "myorg/team-x-app",
    "ref": "refs/heads/main"
  },
  "token_spec": {
    "scope": "applied-permissions/groups:team-x-devs",
    "expires_in": 3600,
    "audience": "*@*"
  }
}
```

- `claims` are exact-match strings; **all** must match for the
  mapping to apply. Wildcards are not supported.
- `priority` breaks ties when multiple mappings match. Lower number
  = higher priority. Use distinct priorities.
- `token_spec.expires_in` in seconds. Keep short (≤ 3600) for CI.
- `token_spec.audience` restricts where the token can be used.
  `*@*` means any service on the platform.

### Scope syntax

| `token_spec.scope`                                         | Effect                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| `applied-permissions/admin`                                | Platform admin. Avoid for CI.                                   |
| `applied-permissions/groups:<group>[,<group>...]`          | Effective permissions = union of named groups. **Recommended.** |
| `applied-permissions/user`                                 | OIDC subject acts as a specific user. Last resort.              |

Tie one identity mapping per project to a group like
`applied-permissions/groups:team-x-devs`; that group's project role
controls effective access.

## CI claim recipes

The claim names below come from the CI system; they are what the
runner puts into the OIDC ID token before sending it to JFrog.

### GitHub Actions

Useful claims: `repository` (`<org>/<repo>`), `repository_owner`,
`ref` (full git ref), `workflow`, `event_name`, `environment`,
`actor`.

```json
{
  "name": "main-branch-publish",
  "claims": {
    "repository": "myorg/team-x-app",
    "ref": "refs/heads/main",
    "event_name": "push"
  },
  "token_spec": { "scope": "applied-permissions/groups:team-x-devs", "expires_in": 3600 }
}
```

Tag publishes can't be filtered with a `refs/tags/*` wildcard
(exact match only) — restrict by `workflow` (e.g.
`workflow: release.yml`) and let the workflow gate tags. PR checks:
`{repository, event_name: pull_request}` mapped to a read-only
group.

Use the
[setup-jfrog-cli](https://github.com/jfrog/setup-jfrog-cli) action
to handle the handshake; it reads
`ACTIONS_ID_TOKEN_REQUEST_TOKEN` / `_URL` automatically.

### GitLab CI

Useful claims: `project_path` (`<group>/<project>`),
`namespace_path`, `ref`, `ref_type` (`branch`|`tag`),
`pipeline_source`, `user_email`, `user_login`.

```json
{
  "name": "main-branch-publish",
  "claims": {
    "project_path": "myorg/team-x-app",
    "ref_type": "branch",
    "ref": "main"
  },
  "token_spec": { "scope": "applied-permissions/groups:team-x-devs", "expires_in": 3600 }
}
```

GitLab exposes the ID token via the `id_tokens:` keyword.

### Generic OIDC (Okta, Auth0, Keycloak, etc.)

Use `provider_type: "generic"`. Minimum viable claims: `iss`
(already validated by the provider config), `aud` (must match the
provider's `audience`), `sub` (subject — for service identities
this is often the only stable claim).

```json
{
  "name": "service-account-build",
  "claims": { "sub": "service-account-build", "aud": "https://mycompany.jfrog.io" },
  "token_spec": { "scope": "applied-permissions/groups:build-bots", "expires_in": 1800 }
}
```

## Exchanging an OIDC token from a CI job

Prefer the official integration
([setup-jfrog-cli](https://github.com/jfrog/setup-jfrog-cli) for
GitHub Actions, the JFrog GitLab CI integration, the official
Bitbucket Pipe). Manual exchange via `jf exchange-oidc-token`
(alias `jf eot`):

```bash
JFROG_OIDC_TOKEN="$(<request-OIDC-token-from-runner>)"
jf exchange-oidc-token \
  --url=https://mycompany.jfrog.io \
  --provider-name=team-x-gha \
  --oidc-token="$JFROG_OIDC_TOKEN" \
  > /tmp/jfrog-token.json
ACCESS_TOKEN=$(jq -r '.access_token' /tmp/jfrog-token.json)
jf c add ci-server --url=https://mycompany.jfrog.io \
  --access-token="$ACCESS_TOKEN" --interactive=false
```

The exchanged token expires after `token_spec.expires_in` seconds —
long jobs must re-exchange, not extend an existing token. Never log
either the input OIDC token or the exchanged JFrog access token.

## Verifying without running CI

`GET` the provider and mappings to confirm config; then use a
manually-crafted ID token (from a CI runner debug job or your IdP's
test endpoint) and call `jf eot` from a workstation. A successful
exchange returns a JFrog access token; a failed exchange surfaces
the mismatch reason.

Common errors: **401** (token's `iss` doesn't match provider's
`issuer_url`, or `aud` mismatch); **403** after exchange (mapping's
`token_spec.scope` lacks permission for the operation); **"no
matching identity mapping"** (claim values don't exactly match any
mapping).
