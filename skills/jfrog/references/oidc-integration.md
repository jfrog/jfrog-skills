# OIDC integration

When to read this file:

- Configuring an OpenID Connect provider on the JFrog Platform.
- Wiring a CI system (GitHub Actions, GitLab CI, generic OIDC) to authenticate
  to JFrog without static credentials.
- Creating or auditing **identity mappings** that bind incoming OIDC claims to
  JFrog roles, groups, or project scopes.
- Using `jf exchange-oidc-token` (alias `jf eot`) inside a CI job to mint a
  short-lived JFrog access token.

For the conceptual role of OIDC inside a project's identity strategy, see
[`projects-best-practices.md`](projects-best-practices.md) §"OIDC for CI
authentication". For project-side member/role wiring, see
[`projects-api.md`](projects-api.md).

All endpoints below run through `jf api` (see the base SKILL.md *Invoking
platform APIs with `jf api`* section). Calls require
`required_permissions: ["full_network"]` in the Shell tool. OIDC provider and
identity-mapping management requires platform-admin permissions on the
resolved server.

Source: [OpenID Connect Integration](https://docs.jfrog.com/administration/docs/openid-connect-integration).

## Two-layer model

```mermaid
flowchart LR
    CI[CI job runner] -->|"OIDC ID token"| Provider[OIDC provider config<br/>POST /access/api/v1/oidc]
    Provider -->|"validates issuer + audience"| Mapping[Identity mapping<br/>claim filter + token spec]
    Mapping -->|"issues JFrog access token"| JF[JFrog Platform token<br/>scope: applied-permissions/groups:..."]
    JF -->|"used by jf rt / jf api"| Resources[Project resources]
```

- **OIDC provider config** — one entry per external issuer (one for GitHub
  Actions, one for GitLab Cloud, one for an internal IdP). Holds
  `issuer_url`, `provider_type`, audience, and (for some types) public-key
  configuration.
- **Identity mappings** — children of a provider. Each mapping pairs a
  **claim filter** (e.g. `repository = myorg/team-x-app`) with a **token
  spec** (scope, expiry, refreshability). Multiple mappings on one provider
  let one CI system serve many projects.

The `provider` is platform-scoped; the `token_spec.scope` inside a mapping is
how OIDC connects to a specific project — for example
`applied-permissions/groups:team-x-devs` issues a token whose effective
permissions are those of the `team-x-devs` group, which has its own project
role assignment.

## Providers

### List providers

```bash
jf api /access/api/v1/oidc
```

Returns an array of provider objects (`name`, `provider_type`, `issuer_url`,
`audience`, `description`).

### Get a provider

```bash
jf api /access/api/v1/oidc/<provider-name>
```

### Create a provider

```bash
jf api /access/api/v1/oidc \
  -X POST -H "Content-Type: application/json" \
  -d '{
    "name": "team-x-gha",
    "issuer_url": "https://token.actions.githubusercontent.com",
    "provider_type": "github",
    "description": "GitHub Actions for myorg/team-x-* repos",
    "audience": "https://mycompany.jfrog.io"
  }'
```

Common `provider_type` values: `github`, `gitlab`, `generic`. Platform
versions add additional first-class types over time — call
`GET /access/api/v1/oidc` on the target server to see what is currently
recognised before assuming a value.

### Update a provider

```bash
jf api /access/api/v1/oidc/<provider-name> \
  -X PUT -H "Content-Type: application/json" \
  -d '{"description": "Updated description"}'
```

### Delete a provider

```bash
jf api /access/api/v1/oidc/<provider-name> -X DELETE
```

Deleting a provider also removes its identity mappings.

## Identity mappings

### List mappings on a provider

```bash
jf api /access/api/v1/oidc/<provider-name>/identity_mappings
```

Returns an array of mapping objects, each with `name`, `priority`, `claims`,
`token_spec`, and `description`.

### Get a mapping

```bash
jf api /access/api/v1/oidc/<provider-name>/identity_mappings/<mapping-name>
```

### Create a mapping

```bash
jf api /access/api/v1/oidc/<provider-name>/identity_mappings \
  -X POST -H "Content-Type: application/json" \
  -d '{
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
    },
    "description": "Issue Developer-scope tokens for main-branch builds"
  }'
```

The mapping match rules:

- **`claims`** is an object whose keys are claim names from the incoming
  OIDC token; values are exact-match strings. **All** claims must match for
  the mapping to apply.
- **`priority`** breaks ties when multiple mappings could match. Lower number
  = higher priority. Use distinct priorities to make ordering explicit.
- **`token_spec.scope`** uses the standard JFrog scope syntax:
  - `applied-permissions/admin` — platform admin (avoid for CI)
  - `applied-permissions/groups:<group>[,<group>]` — recommended; effective
    permissions are the union of the named groups
  - `applied-permissions/user` — the OIDC subject acts as a specific user
- **`token_spec.expires_in`** in seconds. Keep short (≤ 3600) for CI.
- **`token_spec.audience`** restricts where the token can be used; `*@*`
  means any service on the platform.

### Update a mapping

```bash
jf api /access/api/v1/oidc/<provider-name>/identity_mappings/<mapping-name> \
  -X PUT -H "Content-Type: application/json" \
  -d '{"token_spec": {"scope": "applied-permissions/groups:team-x-leads", "expires_in": 1800}}'
```

### Delete a mapping

```bash
jf api /access/api/v1/oidc/<provider-name>/identity_mappings/<mapping-name> \
  -X DELETE
```

## CI claim recipes

The claim names below come from the CI system itself — they are what the CI
runner puts into the OIDC ID token before sending it to JFrog.

### GitHub Actions

Common claims worth filtering on:

- `repository` — `<org>/<repo>` (e.g. `myorg/team-x-app`)
- `repository_owner` — `<org>` (e.g. `myorg`)
- `ref` — full git ref (e.g. `refs/heads/main`, `refs/tags/v1.2.3`)
- `workflow` — workflow file name
- `event_name` — `push`, `pull_request`, `workflow_dispatch`, etc.
- `environment` — set when the job uses an `environment:` declaration
- `actor` — username that triggered the run

Recommended mappings:

- **Main-branch publish** — claims `{repository, ref: refs/heads/main}` →
  scope `groups:<team>-devs`.
- **Tag release publish** — claims `{repository, ref: refs/tags/*}` is **not**
  supported (exact match only); instead, restrict by `workflow` (e.g.
  `workflow: release.yml`) and rely on the workflow itself to gate tags.
- **PR check (read-only)** — claims `{repository, event_name: pull_request}`
  → scope `groups:<team>-pr-checkers` with read-only permissions.

CI runner side: GitHub Actions exposes the OIDC token via
`actions/checkout` + `actions/jf-setup-cli`, or via the
`ACTIONS_ID_TOKEN_REQUEST_TOKEN` and `ACTIONS_ID_TOKEN_REQUEST_URL`
environment variables. The
[setup-jfrog-cli](https://github.com/jfrog/setup-jfrog-cli) action handles
the OIDC handshake and configures the CLI in one step.

### GitLab CI

Common claims:

- `project_path` — `<group>/<project>`
- `namespace_path` — top-level group
- `ref` — full git ref
- `ref_type` — `branch` or `tag`
- `pipeline_source` — `push`, `merge_request_event`, etc.
- `user_email`, `user_login`

Recommended mapping:

- Claims `{project_path: myorg/team-x-app, ref_type: branch, ref: main}` →
  scope `groups:<team>-devs`.

The GitLab CI runner exposes an `ID_TOKEN` job variable via the
`id_tokens:` keyword.

### Generic OIDC (any IdP)

For an internal IdP (Okta, Auth0, Keycloak, Azure AD as identity provider for
non-Azure resources), use `provider_type: "generic"`. The minimum viable claim
set is:

- `iss` — issuer URL (already validated by the provider config)
- `aud` — must match the provider's `audience`
- `sub` — subject identifier; for service identities this is the only stable
  claim available

A typical generic mapping:

```json
{
  "name": "service-account-build",
  "claims": { "sub": "service-account-build", "aud": "https://mycompany.jfrog.io" },
  "token_spec": { "scope": "applied-permissions/groups:build-bots", "expires_in": 1800 }
}
```

## Using OIDC from a CI job

Two paths inside a CI job. Prefer the first when available.

### 1. Setup-jfrog-cli action / official integration

Use the official integration (e.g.
[setup-jfrog-cli](https://github.com/jfrog/setup-jfrog-cli) for GitHub
Actions, the JFrog GitLab CI integration, the official Bitbucket Pipe). It
performs the OIDC handshake and runs `jf c add` for the rest of the job.

### 2. Manual exchange via `jf exchange-oidc-token`

Inside the CI job:

```bash
JFROG_OIDC_TOKEN="$(<request-the-OIDC-token-from-the-CI-runner>)"
jf exchange-oidc-token \
  --url=https://mycompany.jfrog.io \
  --provider-name=team-x-gha \
  --oidc-token="$JFROG_OIDC_TOKEN" \
  > /tmp/jfrog-token.json
ACCESS_TOKEN=$(jq -r '.access_token' /tmp/jfrog-token.json)
jf c add ci-server \
  --url=https://mycompany.jfrog.io \
  --access-token="$ACCESS_TOKEN" \
  --interactive=false
```

Notes:

- `jf eot` is the short alias for `jf exchange-oidc-token`.
- The exchanged JFrog token expires after `token_spec.expires_in` seconds —
  jobs longer than that must re-exchange or use a token refresh, not extend
  expiry on the existing token.
- The OIDC token from the CI runner is the **input**; the JFrog access token
  is the **output**. Never log either of them.

## Listing and revoking issued tokens

OIDC-issued access tokens appear in the standard token list:

```bash
jf api /access/api/v1/tokens
```

Filter on `subject` patterns to find OIDC-issued tokens (the subject usually
encodes the provider name and the matched mapping).

Revoke an individual token:

```bash
jf api /access/api/v1/tokens/<token-id> -X DELETE
```

To force expiry across an entire CI integration, delete the **provider**
(remove and recreate); deleting individual mappings prevents future tokens
without revoking already-issued ones.

## Common errors

- **401 from the OIDC exchange** — the OIDC token's `iss` does not match the
  provider's `issuer_url`, or the `aud` does not match the provider's
  `audience`. Inspect the OIDC token (decode the JWT payload) and confirm.
- **403 after exchange** — the exchange succeeded but the issued JFrog token
  lacks permissions for the requested operation. Check the matched
  mapping's `token_spec.scope` against the project role bound to that group.
- **No mapping matched** — the exchange returns 4xx with a "no matching
  identity mapping" error. Add or relax the mapping; verify claim values
  with the actual OIDC token.
- **Token expiry mid-job** — `token_spec.expires_in` is too short for the
  longest CI step. Increase it for that mapping (within reason; never
  exceed an hour for CI).
- **Provider deletion cascades** — deleting a provider deletes all its
  identity mappings. There is no undo.

## Verifying an OIDC setup without running CI

After creating a provider and mappings, you can verify wiring without a real
CI run:

1. `GET /access/api/v1/oidc/<provider>` — confirm `issuer_url`, `audience`,
   `provider_type`.
2. `GET /access/api/v1/oidc/<provider>/identity_mappings` — confirm priority
   ordering and claim filters.
3. Use a manually-crafted ID token (from the CI runner via a debug job, or
   via your IdP's test endpoint) and call
   `jf eot --provider-name=<provider> --oidc-token=<token>` from a
   workstation. A successful exchange returns a JFrog access token; a
   failed exchange surfaces the mismatch reason.

## Further reading

- [`projects-best-practices.md`](projects-best-practices.md) §Phase 2 — why
  OIDC is the recommended identity strategy.
- [`projects-api.md`](projects-api.md) — project-side roles, members, and
  groups that OIDC mappings target.
- [OpenID Connect Integration](https://docs.jfrog.com/administration/docs/openid-connect-integration)
  — full vendor documentation.
- [setup-jfrog-cli](https://github.com/jfrog/setup-jfrog-cli) — official
  GitHub Actions integration.
