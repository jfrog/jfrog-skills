# Credential Extraction Patterns

How to obtain JFrog Platform credentials for API calls outside the CLI's
built-in authentication.

## Prerequisites

- `jf` CLI installed and configured with at least one server
- `base64` command available (standard on macOS and Linux)
- `jq` available (standard jq JSON processor)

## Response handling (network-backed commands)

Use this whenever the JSON (or text) body comes from a **JFrog network
request**, including:

- **`jf rt curl`** and **`jf xr curl`** (Tier 1 and Tier 2 in `SKILL.md`)
- **Tier 3** `curl` with `Authorization: Bearer` after
  `get-platform-credentials.sh`
- Other **`jf`** read operations that contact the platform over the network
  (same idea: one round-trip per logical fetch)

**Fetch once**, redirect the body to a temp file (for example
`> /tmp/jf-api-$$.json`), then run `jq` on that file. If a filter fails or
you need stderr from jq, adjust and re-run `jq` against the same file—do
**not** repeat the identical network-fetching command in a one-liner with `||`
only to re-parse the same response; that doubles round-trips for no new data.
Local-only commands (for example `jf config show`, `jf --help`) do not need
this anti-pattern to avoid duplicate **HTTP** traffic, though you may still
save output to a file to retry parsing without re-running the command. See
`SKILL.md` (Preserving command output and Gotchas).

## Extracting credentials from `jf config export`

The `jf config export` command produces a base64-encoded JSON token containing
the server URL and access token.

```bash
# For the default server (omit server-id)
JFROG_CONFIG=$(jf config export | base64 -d)

# For a specific server
JFROG_CONFIG=$(jf config export <server-id> | base64 -d)

# Extract individual fields
JFROG_URL=$(echo "$JFROG_CONFIG" | jq -r .url)
JFROG_URL=${JFROG_URL%/}  # Remove trailing slash
JFROG_ACCESS_TOKEN=$(echo "$JFROG_CONFIG" | jq -r .accessToken)
```

The exported JSON contains fields including: `url`, `artifactoryUrl`,
`distributionUrl`, `xrayUrl`, `missionControlUrl`,
`accessToken`, `user`, `serverId`.

## Using the helper script

The skill provides a convenience script that outputs shell variable assignments:

```bash
# Source the credentials into your shell
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh)"

# With a specific server
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh myserver)"
```

After sourcing, these variables are available:
- `JFROG_URL` — platform base URL (no trailing slash)
- `JFROG_ACCESS_TOKEN` — access token for Bearer auth
- `JFROG_RT_URL` — Artifactory URL
- `JFROG_XR_URL` — Xray URL
- `JFROG_DS_URL` — Distribution URL
- `JFROG_MC_URL` — Mission Control URL

## API call patterns by product

### Artifactory (use `jf rt curl`)

No manual credential management needed:
```bash
jf rt curl -XGET /api/repositories
jf rt curl -XGET /api/system/ping
jf rt curl -XPOST /api/search/aql -H "Content-Type: text/plain" -d 'items.find({"repo":"my-repo"})'
```

With a specific server: `jf rt curl --server-id myserver -XGET /api/repositories`

### Xray (use `jf xr curl`)

No manual credential management needed:
```bash
jf xr curl -XGET /api/v2/watches
jf xr curl -XGET /api/v2/policies
jf xr curl -XGET /api/v1/system/ping
```

### Access / Platform Administration

```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh)"
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v2/users/"
```

### Distribution

```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh)"
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/distribution/api/v1/release_bundle"
```

### Evidence

```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh)"
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/evidence/api/v1/evidence"
```

### AppTrust

```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh)"
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/apptrust/api/v1/activity/log"
```

### GraphQL (OneModel)

Full workflow (mandatory schema fetch per server, validation, pagination) is
in `references/onemodel-graphql.md` and **GraphQL (OneModel)** in `SKILL.md`.
Below matches those **credential, schema cache path, and payload** patterns.
`get-platform-credentials.sh` exports `JFROG_SERVER_ID` — use it for the schema
filename so each configured server has its own cache (same as
`onemodel-graphql.md`).

```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh)"

# Schema SDL only in local-cache (not query responses — those go to /tmp)
mkdir -p "<skill_path>/local-cache"
SCHEMA_FILE="<skill_path>/local-cache/onemodel-schema-${JFROG_SERVER_ID}.graphql"
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/onemodel/api/v1/supergraph/schema" \
  -o "$SCHEMA_FILE"

# Execute query — do not use raw -d '{"query":"..."}' (escaping breaks); use jq -n --arg
QUERY='{ evidence { searchEvidence(first: 5, where: { hasSubjectWith: { repositoryKey: "my-repo-local" } } }) { totalCount } } }'
PAYLOAD=$(jq -n --arg q "$QUERY" '{"query": $q}')
RESPONSE_FILE="/tmp/onemodel-response-$$.json"
curl -s -X POST "$JFROG_URL/onemodel/api/v1/graphql" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  -o "$RESPONSE_FILE"
jq . "$RESPONSE_FILE"
```

Authentication requires an access token with wildcard audience (`*@*`).

### Projects

```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh)"
curl -s -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/access/api/v1/projects"
```
