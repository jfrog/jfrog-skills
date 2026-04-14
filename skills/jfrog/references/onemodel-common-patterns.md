# OneModel GraphQL common patterns

General GraphQL patterns and conventions that apply across OneModel domains.
Concrete field names and filter arguments **always** come from the resolved
schema at `GET /onemodel/api/v1/supergraph/schema`.

**When to read this file:** Pagination, filtering, ordering, variables, date
formatting, or interpreting OneModel JSON responses. For the end-to-end
workflow, read `onemodel-graphql.md`.

In shell examples below, `<skill_path>` is this skill's directory.

## Pagination

OneModel uses cursor-based pagination following the Relay specification.

### Forward pagination

Use `first` (page size) and `after` (cursor):

```graphql
query {
  evidence {
    searchEvidence(
      first: 20
      after: "<endCursor-from-previous-page>"
      where: { hasSubjectWith: { repositoryKey: "my-repo-local" } }
    ) {
      edges {
        node {
          predicateSlug
          verified
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```

**To fetch all pages:**

1. First request: omit `after` for the first page.
2. If `pageInfo.hasNextPage` is true, pass `pageInfo.endCursor` as `after`.
3. Repeat until `hasNextPage` is false.

### Backward pagination

Some connections support `last` and `before` (for example `publicPackages.searchPackages`). **`evidence.searchEvidence` does not** — it only accepts `first` and `after`; use forward pagination for evidence.

Example (public catalog):

```graphql
query {
  publicPackages {
    searchPackages(last: 10, before: "<cursor>", where: { type: "npm" }) {
      pageInfo {
        hasPreviousPage
        startCursor
      }
      edges {
        node {
          name
          type
        }
      }
    }
  }
}
```

**Rules:**

- `first/after` and `last/before` are mutually exclusive on the same field when both are supported.
- If no pagination args are provided, the first page is returned (server default
  page size applies).
- Always confirm pagination arguments on the specific field in the supergraph schema.

## Filtering

Use `where` arguments to narrow results. Look up each query's `WhereInput` type
in the schema for available fields.

### Evidence domain

```graphql
searchEvidence(
  where: {
    hasSubjectWith: {
      repositoryKey: "my-repo-local"
      path: "path/to"
      name: "file.ext"
    }
  }
) { ... }
```

### Applications domain

```graphql
searchApplications(
  where: {
    projectKey: "my-project"
    nameContains: "store"
    criticality: "high"
  }
  first: 25
) { ... }
```

### Stored packages domain

`type` is often required; add `name`, `projectKey`, etc. per schema:

```graphql
searchPackages(
  where: { type: "docker", name: "my-image" }
  first: 20
) { ... }
```

To search **versions** of a package, use `searchPackageVersions` with package criteria under `hasPackageWith` (not top-level `type` / `name` on the version filter):

```graphql
searchPackageVersions(
  where: { hasPackageWith: [{ type: "npm", name: "@scope/pkg" }] }
  first: 20
) { ... }
```

### Public packages domain

```graphql
searchPackages(
  where: { type: "npm", nameContains: "lodash" }
  first: 20
) { ... }
```

### Release lifecycle domain

Some filters apply on connection fields:

```graphql
artifactsConnection(
  first: 50
  where: { hasEvidence: true }
) { ... }
```

## Ordering

Use `orderBy` only where the schema defines it. **`evidence.searchEvidence` has no `orderBy` argument.**

Example (applications):

```graphql
query {
  applications {
    searchApplications(
      first: 20
      orderBy: { field: NAME, direction: DESC }
      where: { projectKey: "my-project" }
    ) {
      edges {
        node {
          key
          displayName
        }
      }
    }
  }
}
```

- `field` — sort field (enum or type per schema)
- `direction` — `ASC` or `DESC`

Not every query supports `orderBy` — verify in the schema.

## Variables

Use GraphQL variables instead of string interpolation in the query text.

### Query definition

```graphql
query GetEvidence($repoKey: String!, $path: String!, $name: String!) {
  evidence {
    getEvidence(
      repositoryKey: $repoKey
      path: $path
      name: $name
    ) {
      evidenceId
      verified
    }
  }
}
```

### curl with variables

Build the JSON body with `jq -n` — do not hand-escape quotes inside the query:

```bash
eval "$(bash <skill_path>/scripts/get-platform-credentials.sh [server-id])"

QUERY='query GetEvidence($repoKey: String!, $path: String!, $name: String!) { evidence { getEvidence(repositoryKey: $repoKey, path: $path, name: $name) { evidenceId verified } } }'

PAYLOAD=$(jq -n \
  --arg q "$QUERY" \
  --arg repoKey "example-repo-local" \
  --arg path "path/to" \
  --arg name "file.ext" \
  '{"query": $q, "variables": {"repoKey": $repoKey, "path": $path, "name": $name}}')

RESPONSE_FILE="/tmp/onemodel-response-$$.json"
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JFROG_ACCESS_TOKEN" \
  "$JFROG_URL/onemodel/api/v1/graphql" \
  -d "$PAYLOAD" \
  -o "$RESPONSE_FILE"

jq . "$RESPONSE_FILE"
```

Echo `$RESPONSE_FILE` if a follow-up Shell call must read it (see SKILL.md
*Preserving command output*).

## Date formatting

Fields ending in `...At` (e.g. `createdAt`) default to ISO-8601 UTC:
`2024-11-05T13:15:30.972Z`

Use the `@dateFormat` directive where supported:

```graphql
query {
  evidence {
    searchEvidence(
      first: 5
      where: { hasSubjectWith: { repositoryKey: "my-repo-local" } }
    ) {
      edges {
        node {
          createdAt @dateFormat(format: DD_MMM_YYYY)
        }
      }
    }
  }
}
```

Common formats (verify enum values in schema):

- Default: ISO-8601 UTC
- `DD_MMM_YYYY` — e.g. `05 Nov 2024`
- `ISO8601_DATE_ONLY` — e.g. `2024-11-05`

## Response structure

### Successful response

```json
{
  "data": {
    "<namespace>": {
      "<queryName>": {
        "edges": [
          {
            "node": {},
            "cursor": "abc123"
          }
        ],
        "pageInfo": {
          "hasNextPage": true,
          "endCursor": "abc123"
        },
        "totalCount": 42
      }
    }
  }
}
```

- `edges` — each item has `node` and optional `cursor`
- `pageInfo` — pagination metadata
- `totalCount` — not every connection exposes it; if validation fails, omit it
  and use `pageInfo` only

### Error response

```json
{
  "errors": [
    {
      "message": "description of what went wrong",
      "path": ["evidence", "searchEvidence"],
      "extensions": {
        "code": "GRAPHQL_VALIDATION_FAILED"
      }
    }
  ]
}
```

Errors and `data` can coexist — partial success is possible.

## Experimental and deprecated fields

- `@experimental` — may change; use with caution.
- `@deprecated` — migrate to replacements listed in the schema.

Check directives when exploring the supergraph schema file.
