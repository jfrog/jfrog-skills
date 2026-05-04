# OneModel GraphQL (JFrog Platform)

Run OneModel GraphQL queries against the JFrog Platform to fetch information
about applications, release bundles, artifacts, builds, evidence, packages,
catalog data, and more through the unified OneModel endpoint.

**When to read this file:** Any OneModel GraphQL query, schema discovery, or
when the user asks to list or search platform entities via GraphQL. For
domain-specific query shapes, read `onemodel-query-examples.md`. For
pagination, variables, and date formatting, read `onemodel-common-patterns.md`.

In examples below, `<skill_path>` is this skill's directory (parent of
`references/`).

## `~/.jfrog/skills-cache/` policy

The skill cache lives under `${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}/skills-cache/`
(co-located with `jf config`, **not** inside the installed skill tree). It holds
**only**:

1. **`onemodel-schema-${JFROG_SERVER_ID}.graphql`** — this workflow (supergraph
   SDL cache). **Always** use the path in [Fetch the schema](#2-fetch-the-schema);
   do not mirror the schema under `/tmp`.
2. **`jfrog-skill-state.json`** — environment check (see main SKILL.md); scripts
   manage it; do not delete or replace it casually.

**Never** store GraphQL **query responses**, REST bodies, reports, or other
scratch files under `skills-cache/`. For responses, use `/tmp` with a unique name
(`$$`, `mktemp -d`) as in [Execute the query](#6-execute-the-query) — the
example `RESPONSE_FILE` paths must stay outside `skills-cache/`.

## Prerequisites

- **JFrog CLI** (`jf`) configured with at least one server — follow the main
  SKILL.md environment check and **Server selection rules** before querying.
- **Artifactory 7.104.1+** — OneModel GraphQL requires this minimum version.
- **`jq`** on `PATH` (same as the base skill). HTTP calls go through
  `jf api`; no standalone `curl` is needed.

## Workflow

Follow these steps in order. Skipping the schema fetch (step 2) is the most
common source of errors — queries built from assumptions or cached knowledge
will fail on servers whose schema differs from what you expect.

1. **Resolve the target server** — derive `JFROG_SERVER_ID` from `jf config`
2. **Fetch the schema** — always fetch the supergraph schema from the server
3. **Understand the query intent** — map the user's request to domains and types
4. **Construct the GraphQL query** — build from the resolved schema only
5. **Validate the query against the schema** — verify every field and type
6. **Execute the query** — POST to the OneModel endpoint; save response to a file
7. **Handle the response** — paginate if needed; present results clearly

### 1. Resolve the target server

Authentication is handled automatically by `jf api` against the active (or
`--server-id`-specified) server. You only need the server-id locally — for
caching the schema file per server. Derive it from `jf config`:

```bash
# User-specified server:
JFROG_SERVER_ID="<server-id>"

# Or the current default:
JFROG_SERVER_ID=$(jf config show --server-id 2>/dev/null \
  || jf config export | base64 -d | jq -r '.servers[] | select(.isDefault==true).serverId')
```

If the user named a specific server, pass `--server-id "$JFROG_SERVER_ID"` to
every `jf api` invocation in steps 2 and 6 so the query hits that server
(see SKILL.md § *Server selection rules*).

### 2. Fetch the schema

**This step is mandatory for custom or novel queries.** You need the supergraph
schema from the specific JFrog server you are working with.

#### Shortcut for well-known query patterns

When using a query shape that comes directly from `onemodel-query-examples.md`
**without modifications** (same fields, same filters, same argument types), you
may skip the full schema fetch and execute immediately. The example queries in
that file are maintained against real servers and are unlikely to drift for
stable domains like `publicPackages`, `storedPackages`, and `evidence`.

**Fallback rule:** If the query returns `GRAPHQL_VALIDATION_FAILED` or
unexpected empty results, fetch the schema (as described below), verify the
query against it, and retry. Do not attempt more than one execution without
schema verification.

The schema is large. Cache it under the skill cache directory (the JFrog CLI
home — outside the installed skill tree) keyed by the concrete
`JFROG_SERVER_ID` from step 1 (the CLI `serverId`, never a placeholder like
`default`).

**Always use this exact path** — do not save the schema to `/tmp/` or any other
location. The cache path is:

`${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}/skills-cache/onemodel-schema-${JFROG_SERVER_ID}.graphql`

Run the following block as-is. It checks for an existing cached file and only
fetches when missing:

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

(Omit `--server-id "$JFROG_SERVER_ID"` to target the active default server.)

After the block runs, **read `$SCHEMA_FILE` from disk** for all subsequent
schema lookups — never re-fetch to a different path.

If the fetch fails (HTTP 401/403, empty file, or network error), verify the
access token, wildcard audience, base URL (no trailing path beyond the host), and
server version. If the schema file is empty or contains an HTML error page,
delete it and retry the block above.

The schema file is SDL — namespaces, types, fields, arguments, enums, and
directives for **this** server.

#### Navigating the schema

The schema is large (typically 10,000+ lines). Do not read it in full. Use
targeted searches:

1. **Find available namespaces** — search for lines matching `: ...Queries!`
   near the root `Query` definition (e.g. `applications: ApplicationsQueries!`).
2. **Find operations for a namespace** — search for the `...Queries` type name
   to see `get...` and `search...` methods.
3. **Find input/filter types** — from the operation signature, look up the
   `WhereInput` type to see available filters.
4. **Find output fields** — look up the node type to see which fields you can
   request.

When reading the schema, **ignore types and fields annotated with
`@inaccessible`.** These are internal federation artifacts and are not queryable
through the OneModel endpoint.

#### Never assume — always verify in the schema

Before constructing any query, look up every type you intend to use. Common
mistakes:

- **Scalars vs enums** — A name like `FooType` may be a `scalar` (string)
  or an `enum`. Search for `scalar FooType` vs `enum FooType` to know
  whether to pass a quoted string (`"something"`) or a bare identifier.
- **Connection fields vs plain fields** — Look for `...Connection` naming;
  verify exact field names and required arguments on the parent type.
- **Nested types** — When a field returns a complex type, look up that type's
  definition for subfields; do not guess names.

#### Read the descriptions

Schema descriptions (`"""..."""` above types, fields, and arguments) encode
accepted values, matching behavior, and constraints. Read a few lines above
each definition you use.

**Why this matters:** The OneModel supergraph is composed per server from
products, entitlements, and license. Different servers expose different domains.
The resolved schema is the only reliable source of truth.

**Do NOT rely on:**

- Public documentation alone — it may not list every domain on your server.
- Hardcoded examples without schema verification — see
  `onemodel-query-examples.md` as patterns only.
- Legacy metadata GraphiQL (`/metadata/api/v1/query/graphiql`) — deprecated;
  it does not reflect the OneModel schema.

### 3. Understand the query intent

Using the schema from step 2, map the user's request to available domains.
Search for root `Query` and `: ...Queries!` lines to see namespaces on this
server.

Common domains you **may** find (always verify in the schema):

- **Applications** — applications, versions, bound package versions
- **Release lifecycle** — release bundle versions, artifacts, source builds
- **Evidence** — evidence on artifacts, repos, or release bundles
- **Stored packages** — packages and versions in Artifactory repos
- **Public / custom catalog** — public registry metadata, catalog packages,
  security/legal/operational info

If no matching types exist, tell the user the capability is not exposed on this
server.

**Note:** Legacy metadata GraphQL (`packages` at `/metadata/api/v1/query`) is
deprecated and **not** part of OneModel. Use `/onemodel/api/v1/graphql` only.

### 4. Construct the GraphQL query

Build the query using **only** types, fields, and arguments from the resolved
schema.

#### Pre-construction checklist

1. Look up every argument type (`where`, `orderBy`, etc.).
2. Look up every output type and required subfield selections for object types.
3. Look up every `WhereInput` and nested filter shape.
4. Trace the full path from root to leaf and confirm each hop exists.

#### Principles

- Prefer **one query** that returns what the user needs (nested fields,
  filters) to minimize round-trips.
- Request **only needed fields**.
- On validation errors, **simplify** the query (e.g. one scalar field per
  connection) to isolate the bad filter or field. Request `totalCount` only if
  that connection type defines it in the schema (many metadata connections do
  not).
- Use **`where`** in the query instead of fetching everything client-side.
- Use **pagination** — include `first` (or `last`) and
  `pageInfo { hasNextPage endCursor }` for large sets.
- Use **GraphQL variables** for dynamic values (see `onemodel-common-patterns.md`).

#### Naming convention

- `get...` — single item
- `search...` — list / connection-style results

### 5. Validate the query against the schema

Before executing, verify:

1. Every field name matches the schema (casing, suffixes like `...Connection`).
2. Every object-typed field has a subfield selection.
3. Every argument value matches scalar vs enum vs input rules.
4. Nested `where` paths exist end-to-end on the corresponding input types.
5. Connection fields include pagination arguments as required.
6. **Brace balance** — every `{` in the document (selection sets and input
   objects) has exactly one matching `}`. Deep nesting is easy to get wrong in
   a single-line shell string; prefer a `.graphql` file or heredoc so structure
   is visible (see below).

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

Redirect `jf api`'s stdout to `$RESPONSE_FILE` so you can re-`jq` without
re-querying. **Do not pipe `jf api` directly to `jq`** — a wrong filter
loses the response. **Do not** set `RESPONSE_FILE` under
`~/.jfrog/skills-cache/` — that directory is only for the schema cache and
`jfrog-skill-state.json` (see [`~/.jfrog/skills-cache/` policy](#jfrogskills-cache-policy)
above).

For multiple queries in one shell session, use a temp directory under `/tmp` and
sequential names:

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

Do **not** hand-embed the GraphQL string inside a JSON literal — escaping breaks
easily. Build the payload JSON with `jq`, write it to a **file**, and pass the
file to `jf api` with `--input`. `jf api` does not accept stdin for `--data`;
`--input` expects a file path.

##### Avoid `PARSING_ERROR` (broken GraphQL documents)

A response with `extensions.code: PARSING_ERROR` (often `expected a StringValue,
Name or OperationDefinition` at **line 1, column N**) means the **document
text** is invalid — usually **too many or too few `}`** — before the server
checks fields against the schema. This happens most often when a long query is
pasted into `QUERY='...'` as **one bash line**: braces are hard to count, and a
typo near the end surfaces as an error at a **high column number**.

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

Strip `#` comments and collapse whitespace only if you need a single-line
payload; often you can pass the file content as-is if it has no comments.

With variables, add more `--arg` flags and a `variables` object (see
`onemodel-common-patterns.md`).

### 7. Handle the response

Always read from `$RESPONSE_FILE` for further extraction or formatting.

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

Errors appear in an `errors` array. Partial data may coexist with errors.

| Symptom | Likely cause | Action |
|--------|---------------|--------|
| 401 | Invalid or expired token | Re-run the login flow (`references/jfrog-login-flow.md`) for the same server |
| 403 | Insufficient permissions | User/token lacks access to the resource |
| `GRAPHQL_VALIDATION_FAILED` | Bad field or argument | Re-check schema |
| `PARSING_ERROR` / syntax at **line 1, column N** | Invalid document (often extra/missing `}`); common with long `QUERY='...'` one-liners | Reformat in a `.graphql` file or heredoc; verify brace balance; use `jq --rawfile` |
| Empty results | Filters or no data | Broaden filters or verify data exists |

#### Pagination

If `pageInfo.hasNextPage` is true, pass `endCursor` as `after` on the next
request. Save each page to a new `response-N.json`. Details:
`onemodel-common-patterns.md`.

## GraphQL Playground

The Platform UI includes a GraphQL Playground: **Integrations > GraphQL
Playground**, or:

`$JFROG_URL/ui/onemodel/playground`

Suggest it when:

- Queries are deeply nested or cross-domain and hard to get right in one turn
- Multiple attempts failed and autocomplete would help
- The user wants to explore capabilities rather than run one fixed query
- The user asks for a UI or visual GraphQL explorer

Include the resolved base URL so they can open it immediately.

### Official documentation

- [JFrog OneModel GraphQL](https://jfrog.com/help/r/jfrog-rest-apis/jfrog-one-model-graphql)
- [OneModel common patterns](https://jfrog.com/help/r/jfrog-rest-apis/one-model-graphql-common-patterns-and-conventions)
- [Release lifecycle GraphQL examples](https://jfrog.com/help/r/jfrog-rest-apis/get-release-bundle-v2-version-graphql-use-cases-examples)
- [GraphQL introduction](https://graphql.org/learn/)

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

- `onemodel-query-examples.md` — illustrative templates per domain (verify
  against schema before use).
- `onemodel-common-patterns.md` — Relay-style pagination, filters, variables,
  date formatting, response shapes.
