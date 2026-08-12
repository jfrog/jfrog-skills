# Invoking platform APIs with `jf api`

> **Tier B MUST** before `jf api`. Not domain on-demand; not required for every CLI / setup.

`jf api` is the Tier 3 entry point for JFrog Platform REST and GraphQL
endpoints, auto-authenticated against the resolved server. **Do not use
`jf rt curl` or `jf xr curl`** — superseded by `jf api`.

## Product-prefix table

`jf api` requires the **full** path including the product prefix; omitting it
returns 404.

| Product | Path prefix |
|---------|-------------|
| Artifactory | `/artifactory/api/...` |
| Xray | `/xray/api/...` |
| Access (users, groups, tokens, permissions, projects) | `/access/api/...` |
| Evidence | `/evidence/api/...` |
| Release Lifecycle | `/lifecycle/api/...` |
| AppTrust | `/apptrust/api/...` |
| Distribution | `/distribution/api/...` |
| OneModel (GraphQL) | `/onemodel/api/v1/graphql`, `/onemodel/api/v1/supergraph/schema` |
| Mission Control | `/mc/api/...` |
| Curation | `/xray/api/v1/curation/...` (lives under Xray) |

## Examples

```bash
jf api /artifactory/api/repositories
jf api --server-id <SID> /artifactory/api/system/version

# AQL (POST with text/plain body)
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" -d '<aql-query>'
```

Common flags: `-X/--method`, `-H/--header`, `-d/--data`, `--input <file>`,
`--server-id`, `--timeout`. Body on stdout, status on stderr — see
`references/cli-gotchas.md`.

## GraphQL (OneModel)

OneModel is the unified GraphQL API. **Do not** embed the query inside a JSON
literal (`-d '{"query":"..."}'`) — escaping breaks requests. Build the payload
with `jq -n --arg`, pass it via `--input`, and save the response to a file
before running `jq` on it.

```bash
QUERY='{ evidence { searchEvidence(first: 5, where: { hasSubjectWith: { repositoryKey: "my-repo-local" } }) { totalCount } } }'
PAYLOAD=/tmp/onemodel-payload-$$.json RESPONSE=/tmp/onemodel-$$.json
jq -n --arg q "$QUERY" '{query:$q}' > "$PAYLOAD"
jf api /onemodel/api/v1/graphql -X POST \
  -H "Content-Type: application/json" --input "$PAYLOAD" > "$RESPONSE"
jq . "$RESPONSE"
```

Schema discovery: `jf api /onemodel/api/v1/supergraph/schema > "$SCHEMA_FILE"`
(store only under `~/.jfrog/skills-cache/`, never query responses). Read
`references/onemodel-graphql.md` for the full workflow (schema fetch,
validation, pagination, errors), plus `references/onemodel-query-examples.md`
and `references/onemodel-common-patterns.md` for query shapes, pagination,
variables, and dates.
