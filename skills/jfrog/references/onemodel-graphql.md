# OneModel GraphQL (JFrog Platform)

Run OneModel GraphQL against the JFrog Platform for applications, release
bundles, artifacts, builds, evidence, packages, catalog data, and more via
the unified endpoint.

**Read when:** OneModel GraphQL query, schema discovery, or list/search
platform entities via GraphQL. Domain shapes → `onemodel-query-examples.md`.
Pagination / variables / dates → `onemodel-common-patterns.md`.

In examples, `<skill_path>` is this skill's directory (parent of `references/`).

## `~/.jfrog/skills-cache/` policy

Cache: `${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}/skills-cache/` (with `jf config`,
**not** inside the installed skill). Holds **only**:

1. **`onemodel-schema-${JFROG_SERVER_ID}.graphql`** — this workflow (supergraph
   SDL). **Always** use [Fetch the schema](#2-fetch-the-schema); never mirror
   under `/tmp`.
2. **`jfrog-skill-state.json`** — env check (main SKILL.md); scripts own it;
   do not delete/replace casually.

**Never** store GraphQL **responses**, REST bodies, reports, or scratch under
`skills-cache/`. Responses → `/tmp` with unique name (`$$`, `mktemp -d`) as in
[Execute the query](#6-execute-the-query). `RESPONSE_FILE` must stay outside
`skills-cache/`.

## Prerequisites

- **JFrog CLI** (`jf`) with ≥1 server — main SKILL.md env check + **Server
  selection rules** before querying.
- **Artifactory 7.104.1+** — OneModel GraphQL minimum.
- **`jq`** on `PATH` (base skill). HTTP via `jf api`; no standalone `curl`.

## Workflow

Follow in order. Skipping schema fetch (step 2) is the top error source —
assumed/cached shapes fail when the server schema differs.

1. **Resolve the target server** — `JFROG_SERVER_ID` from `jf config`
2. **Fetch the schema** — always fetch supergraph from the server
3. **Understand the query intent** — map request → domains/types
4. **Construct the GraphQL query** — from resolved schema only
5. **Validate against the schema** — every field and type
6. **Execute** — POST OneModel; save response to a file
7. **Handle the response** — paginate if needed; present clearly

### 1. Resolve the target server

`jf api` authenticates against the active (or `--server-id`) server. You only
need the server-id locally — for per-server schema cache. From `jf config`:

```bash
# User-specified server:
JFROG_SERVER_ID="<server-id>"

# Or the current default:
JFROG_SERVER_ID=$(jf config show --server-id 2>/dev/null \
  || jf config export | base64 -d | jq -r '.servers[] | select(.isDefault==true).serverId')
```

If the user named a server, pass `--server-id "$JFROG_SERVER_ID"` on every
`jf api` in steps 2 and 6 (SKILL.md § *Server selection rules*).

### 2. Fetch the schema

**Mandatory for custom/novel queries.** Need the supergraph from this server.

#### Shortcut for well-known query patterns

Query shape from `onemodel-query-examples.md` **without modifications** (same
fields, filters, arg types) → may skip full schema fetch and execute. Those
examples track real servers; stable domains (`publicPackages`,
`storedPackages`, `evidence`) rarely drift.

**Fallback:** `GRAPHQL_VALIDATION_FAILED` or unexpected empty → fetch schema
(below), verify, retry. Never more than one execution without schema check.

Schema is large. Cache under skill cache (CLI home, outside installed skill),
keyed by concrete `JFROG_SERVER_ID` from step 1 (CLI `serverId`, never a
placeholder like `default`).

**Always this exact path** — not `/tmp/` or elsewhere:

`${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}/skills-cache/onemodel-schema-${JFROG_SERVER_ID}.graphql`

Run as-is — uses cache when present, fetches when missing:

```bash
SCHEMA_FILE="${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}/skills-cache/onemodel-schema-${JFROG_SERVER_ID}.graphql"
if [ -s "$SCHEMA_FILE" ]; then
  echo "Schema cache hit: $SCHEMA_FILE ($(wc -l < "$SCHEMA_FILE") lines)"
else
  mkdir -p "$(dirname "$SCHEMA_FILE")"
  jf api /onemodel/api/v1/supergraph/schema \
    --server-id "$JFROG_SERVER_ID" \
    > "$SCHEMA_FILE"
  echo "Schema fetched: $SCHEMA_FILE ($(wc -l < "$SCHEMA_FILE") lines)"
fi
```

(Omit `--server-id "$JFROG_SERVER_ID"` for the active default server.)

After the block: **read `$SCHEMA_FILE` from disk** for all schema lookups —
never re-fetch to a different path.

Fetch fails (401/403/404, network, timeout) → **stop and report**; fix
token / wildcard audience / base URL (host only, no trailing path) / server
version first — do not blind-retry. Retry the block only after a **successful**
call left an empty file or HTML error page (delete it first).

Schema is SDL — namespaces, types, fields, args, enums, directives for **this**
server.

#### Navigating the schema

Large (typically 10,000+ lines). Do not read in full. Targeted search:

1. **Namespaces** — lines matching `: ...Queries!` near root `Query`
   (e.g. `applications: ApplicationsQueries!`).
2. **Operations** — search `...Queries` type for `get...` / `search...`.
3. **Input/filter types** — from op signature, look up `WhereInput`.
4. **Output fields** — look up node type for selectable fields.

**Ignore `@inaccessible`** — internal federation; not queryable via OneModel.

#### Never assume — always verify in the schema

Before constructing, look up every type you will use. Common mistakes:

- **Scalars vs enums** — `FooType` may be `scalar` (quoted string) or `enum`
  (bare id). Search `scalar FooType` vs `enum FooType`.
- **Connection vs plain** — look for `...Connection`; verify field names and
  required args on the parent.
- **Nested types** — look up returned complex types for subfields; do not guess.

#### Read the descriptions

Schema `"""..."""` above types/fields/args encode accepted values, matching,
constraints. Read a few lines above each definition you use.

**Why:** Supergraph is per-server (products, entitlements, license). Domains
differ. Resolved schema is the only reliable source of truth.

**Do NOT rely on:**

- Public docs alone — may omit domains on your server.
- Hardcoded examples without schema check — `onemodel-query-examples.md` =
  patterns only.
- Legacy metadata GraphiQL (`/metadata/api/v1/query/graphiql`) — deprecated;
  not OneModel.

### 3. Understand the query intent

From step-2 schema, map the request to domains. Search root `Query` and
`: ...Queries!` for namespaces on this server.

Domains you **may** find (always verify):

- **Applications** — apps, versions, bound package versions
- **Release lifecycle** — release bundle versions, artifacts, source builds
- **Evidence** — evidence on artifacts, repos, or release bundles
- **Stored packages** — packages/versions in Artifactory repos
- **Public / custom catalog** — public registry metadata, catalog packages,
  security/legal/operational info

No matching types → tell the user the capability is not on this server.

**Note:** Legacy metadata GraphQL (`packages` at `/metadata/api/v1/query`) is
deprecated and **not** OneModel. Use `/onemodel/api/v1/graphql` only.

### 4. Construct the GraphQL query

Build using **only** types, fields, and args from the resolved schema.

#### Pre-construction checklist

1. Look up every argument type (`where`, `orderBy`, …).
2. Look up every output type and required subfield selections for objects.
3. Look up every `WhereInput` and nested filter shape.
4. Trace root→leaf; confirm each hop exists.

#### Principles

- Prefer **one query** with nested fields/filters (fewer round-trips).
- Request **only needed fields**.
- On validation errors, **simplify** (e.g. one scalar per connection) to
  isolate the bad filter/field. Request `totalCount` only if the connection
  type defines it (many metadata connections do not).
- Prefer **`where`** over fetch-all + client filter.
- **Pagination** — `first`/`last` + `pageInfo { hasNextPage endCursor }` for
  large sets.
- **GraphQL variables** for dynamic values (`onemodel-common-patterns.md`).

#### Naming convention

- `get...` — single item
- `search...` — list / connection-style

### 5. Validate the query against the schema

Before execute, verify:

1. Every field name matches schema (casing, `...Connection` suffixes).
2. Every object-typed field has a subfield selection.
3. Every arg value matches scalar vs enum vs input rules.
4. Nested `where` paths exist end-to-end on input types.
5. Connection fields include required pagination args.
6. **Brace balance** — every `{` has one matching `}`. Prefer `.graphql` file
   or heredoc over a single-line shell string (see below).

### 6. Execute the query

POST to `/onemodel/api/v1/graphql`:

```bash
jf api /onemodel/api/v1/graphql \
  -X POST -H "Content-Type: application/json" \
  --input "$PAYLOAD_FILE" \
  --server-id "$JFROG_SERVER_ID" \
  > "$RESPONSE_FILE"
```

#### Always save the response to a file

Redirect `jf api` stdout → `$RESPONSE_FILE` so you can re-`jq` without
re-querying. **Do not pipe `jf api` to `jq`** — wrong filter loses the
response. **Do not** put `RESPONSE_FILE` under `~/.jfrog/skills-cache/` —
schema + `jfrog-skill-state.json` only (see
[`~/.jfrog/skills-cache/` policy](#jfrogskills-cache-policy)).

Multiple queries in one shell → temp dir under `/tmp` + sequential names:

```bash
ONEMODEL_TMPDIR=$(mktemp -d)
ONEMODEL_QUERY_NUM=0
```

Before each query:

```bash
ONEMODEL_QUERY_NUM=$((ONEMODEL_QUERY_NUM + 1))
RESPONSE_FILE="$ONEMODEL_TMPDIR/response-$ONEMODEL_QUERY_NUM.json"
```

#### Always use `jq` to build the JSON payload

Do **not** hand-embed GraphQL inside a JSON literal — escaping breaks easily.
Build payload with `jq` → **file** → `jf api --input`. `jf api` has no stdin
`--data`; `--input` expects a path.

##### Avoid `PARSING_ERROR` (broken GraphQL documents)

`extensions.code: PARSING_ERROR` (often `expected a StringValue, Name or
OperationDefinition` at **line 1, column N**) → **document text** invalid —
usually **too many/few `}`** — before schema field checks. Common with long
`QUERY='...'` one-liners: braces hard to count; typo near end → high column.

**Do this instead:**

| Query size | How to build the payload |
|------------|-------------------------|
| Tiny (few fields, one level) | `QUERY='...'` plus `jq -n --arg q "$QUERY"` into a file is OK. |
| Anything nested (connections, `where: { ... }`, multiple roots) | Put the document in a **`.graphql` file** (or a **quoted heredoc**) and use **`jq --rawfile`**. Never maintain a 400+ character one-liner in bash. |

Example — **small** query with `jq --arg`:

```bash
QUERY='{ evidence { searchEvidence(first: 5, where: { hasSubjectWith: { repositoryKey: "my-repo-local" } }) { totalCount } } }'
PAYLOAD_FILE="$ONEMODEL_TMPDIR/payload-$ONEMODEL_QUERY_NUM.json"
jq -n --arg q "$QUERY" '{"query": $q}' > "$PAYLOAD_FILE"

jf api /onemodel/api/v1/graphql \
  -X POST -H "Content-Type: application/json" \
  --input "$PAYLOAD_FILE" \
  --server-id "$JFROG_SERVER_ID" \
  > "$RESPONSE_FILE"

jq . "$RESPONSE_FILE"
```

Example — **nested** query from a file (preferred for real OneModel calls):

```bash
# my-query.graphql contains a normal multi-line GraphQL document
PAYLOAD_FILE="$ONEMODEL_TMPDIR/payload-$ONEMODEL_QUERY_NUM.json"
jq -n --rawfile q my-query.graphql \
  '{"query": ($q | gsub("#.*"; "") | gsub("\\s+"; " ") | sub("^ +"; "") | sub(" +$"; ""))}' \
  > "$PAYLOAD_FILE"

jf api /onemodel/api/v1/graphql \
  -X POST -H "Content-Type: application/json" \
  --input "$PAYLOAD_FILE" \
  --server-id "$JFROG_SERVER_ID" \
  > "$RESPONSE_FILE"
```

Strip `#` comments / collapse whitespace only if you need a single-line
payload; often pass file content as-is when comment-free.

With variables: more `--arg` flags + `variables` object
(`onemodel-common-patterns.md`).

### 7. Handle the response

Always read `$RESPONSE_FILE` for further extraction/formatting.

#### Success shape

```json
{
  "data": {
    "<namespace>": {
      "<queryName>": { ... }
    }
  }
}
```

#### Errors

Errors in `errors` array. Partial data may coexist.

| Symptom | Likely cause | Action |
|--------|---------------|--------|
| 401 | Invalid or expired token | Re-run the login flow (`references/jfrog-login-flow.md`) for the same server |
| 403 | Insufficient permissions | User/token lacks access to the resource |
| `GRAPHQL_VALIDATION_FAILED` | Bad field or argument | Re-check schema |
| `PARSING_ERROR` / syntax at **line 1, column N** | Invalid document (often extra/missing `}`); common with long `QUERY='...'` one-liners | Reformat in a `.graphql` file or heredoc; verify brace balance; use `jq --rawfile` |
| Empty results | Filters or no data | Broaden filters or verify data exists |

#### Pagination

`pageInfo.hasNextPage` → pass `endCursor` as `after`. Save each page to a new
`response-N.json`. Details: `onemodel-common-patterns.md`.

## GraphQL Playground

Platform UI: **Integrations > GraphQL Playground**, or
`$JFROG_URL/ui/onemodel/playground`.

Suggest when:

- Deep/cross-domain queries hard to get right in one turn
- Multiple failed attempts; autocomplete would help
- User wants to explore capabilities, not one fixed query
- User asks for a UI / visual GraphQL explorer

Include the resolved base URL so they can open it immediately.

### Official documentation

- https://jfrog.com/help/r/jfrog-rest-apis/jfrog-one-model-graphql
- https://jfrog.com/help/r/jfrog-rest-apis/one-model-graphql-common-patterns-and-conventions
- https://jfrog.com/help/r/jfrog-rest-apis/get-release-bundle-v2-version-graphql-use-cases-examples
- https://graphql.org/learn/

## Gotchas

- **`PARSING_ERROR` at a high column** — almost always mismatched `{` / `}` in
  the document. Use a `.graphql` file and `jq --rawfile`, not a long
  `QUERY='...'` one-liner (see step 6).
- **Schema varies per server** — never assume a domain or field exists; verify in
  the fetched supergraph schema.
- **Ignore `@inaccessible`** — not queryable through OneModel.
- **Scalars vs enums** — wrong literal form can yield empty results without a
  clear error; check the type definition and descriptions.
- **`PackageType` vs `StoredPackageRepositoryType`** — these are both "package
  type" fields but they differ in kind and purpose.
  `PackageType` is a **scalar** (a quoted string like `"npm"`, `"maven"`,
  `"docker"`). It identifies the **package or version** itself and appears on
  `StoredPackage.type`, `PublicPackage.type`, `getPackage(type:)`,
  `searchPackages`, and `searchPackageVersions` where-inputs.
  `StoredPackageRepositoryType` is an **enum** (bare uppercase identifiers like
  `NPM`, `MAVEN`, `DOCKER`). It identifies the **Artifactory repository type**
  that hosts stored packages and appears on `StoredPackage.repositoryPackageType`
  and as an alternative argument on `storedPackages.getPackage(repositoryPackageType:)`.
  The `getPackage` operation on `storedPackages` accepts either — its schema
  description says "At least one of type or repositoryPackageType must be
  provided." Using an enum value where a string is expected (or vice versa) causes
  `GRAPHQL_VALIDATION_FAILED` errors, so always verify which field you are
  targeting before choosing the literal form.
- **OneModel endpoint only:** `POST /onemodel/api/v1/graphql` (full path
  passed to `jf api`). Do not use legacy
  `/metadata/api/v1/query` or its `packages` root for OneModel.
- **Token audience** — wildcard `*@*` is required for typical OneModel use;
  narrow tokens may fail with auth errors.
- **`jf api` handles auth and URL** — it authenticates against the active
  (or `--server-id`-named) server and prepends the configured platform base
  URL. Do not construct OneModel URLs manually or attach bearer tokens
  yourself.
- **Content-Type** — `application/json` on POST.
- **Pagination** — do not mix `first/after` with `last/before` in the same field.
- **Dates** — fields ending in `...At` default to ISO-8601 UTC; `@dateFormat`
  can change output (see `onemodel-common-patterns.md`).
- **`@experimental` / `@deprecated`** — treat per schema directives.
- **Save responses before `jq`** — same rule as SKILL.md *Preserving command
  output* for network-backed calls.

## Related reference files

- `onemodel-query-examples.md` — domain templates (verify against schema).
- `onemodel-common-patterns.md` — Relay pagination, filters, variables, dates,
  response shapes.