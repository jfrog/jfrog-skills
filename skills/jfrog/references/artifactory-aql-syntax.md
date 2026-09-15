# AQL (Artifactory Query Language)

AQL queries are sent as POST requests with `Content-Type: text/plain`:

```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" -d '<query>'
```

## Query structure

```
<domain>.find(<criteria>)
  .include(<fields>)
  .sort(<sort>)
  .offset(<n>)
  .limit(<n>)
  .distinct(<boolean>)
```

Only `.find()` is required; others optional and chainable.
**Server enforces the chain order above.** `.include()` before `.sort()`,
`.sort()` before `.offset()`, etc. Out of order (e.g. `.sort()` before
`.include()`) → parse error.

**Mandatory include fields:** `items` → `"repo","path","name"`; `builds` →
`"name","number","repo"`. Always include these even when you need a subset —
narrow with `jq` post-query:

```
items.find({"name":"commons-lang3-3.12.0.jar"})
  .include("repo","path","name")
  .distinct(true)
```

## Domains

13 queryable domains — each entity type has its own fields.

| Domain               | Query name          | Description                                    |
| -------------------- | ------------------- | ---------------------------------------------- |
| Items                | `items`             | Artifacts stored in repositories (most common) |
| Properties           | `properties`        | Key-value properties on items                  |
| Item infos           | `item.infos`        | Property modification metadata                 |
| Statistics           | `stats`             | Download statistics (local and remote)         |
| Builds               | `builds`            | Build info records                             |
| Build modules        | `modules`           | Modules within a build                         |
| Build artifacts      | `artifacts`         | Artifacts produced by a build module           |
| Build dependencies   | `dependencies`      | Dependencies consumed by a build module        |
| Build properties     | `build.properties`  | Key-value properties on builds                 |
| Build promotions     | `build.promotions`  | Build promotion records                        |
| Module properties    | `module.properties` | Key-value properties on build modules          |
| Release bundles      | `releases`          | Release bundle records                         |
| Release bundle files | `release_artifacts` | Files within a release bundle                  |

## Domain relationships

Join paths below. Cross-domain queries traverse these links — related-domain
fields in criteria/includes use a prefixed domain path.

```mermaid
erDiagram
    items ||--o{ properties : "has"
    items ||--o| item_infos : "has"
    items ||--o{ stats : "has"
    items ||--o{ artifacts : "via checksum"
    items ||--o{ dependencies : "via checksum"
    items ||--o{ release_artifacts : "has"
    artifacts }o--|| modules : "belongs to"
    dependencies }o--|| modules : "belongs to"
    modules }o--|| builds : "belongs to"
    modules ||--o{ module_properties : "has"
    builds ||--o{ build_properties : "has"
    builds ||--o{ build_promotions : "has"
    release_artifacts }o--|| releases : "belongs to"
```

**Key:** Items ↔ build artifacts/dependencies via SHA-1 checksum match (not
a direct key). Path items → builds: items → artifacts → modules → builds.

### Cross-domain field paths

Related-domain field → dot-separated domain path:

```
items.find({"artifact.module.build.name":"my-build"})
  .include("name","repo","path","artifact.module.build.number")
```

Common cross-domain paths from items:

- `stat.downloads`, `stat.downloaded` — download statistics
- `property.key`, `property.value` — item properties
- `artifact.module.build.name` — build that produced the item
- `artifact.module.build.number` — build number

From builds:

- `module.artifact.name` — artifacts in build modules
- `module.dependency.name` — dependencies of build modules

## Fields by domain

Types: `string`, `date`, `int`, `long`, `itemType` (`file`, `folder`, `any`).
"Default" = returned without explicit `.include()`.

### items

| Field           | Type     | Default |
| --------------- | -------- | ------- |
| `repo`          | string   | yes     |
| `path`          | string   | yes     |
| `name`          | string   | yes     |
| `type`          | itemType | yes     |
| `size`          | long     | yes     |
| `depth`         | int      | yes     |
| `created`       | date     | yes     |
| `created_by`    | string   | yes     |
| `modified`      | date     | yes     |
| `modified_by`   | string   | yes     |
| `updated`       | date     | yes     |
| `actual_md5`    | string   | no      |
| `actual_sha1`   | string   | no      |
| `sha256`        | string   | no      |
| `original_md5`  | string   | no      |
| `original_sha1` | string   | no      |

Computed: `virtual_repos` — virtual repos that include the item's actual
repo. Requires `.include("virtual_repos")` plus `repo`,`path`,`name` in
the result set.

### properties

| Field   | Type   | Default |
| ------- | ------ | ------- |
| `key`   | string | yes     |
| `value` | string | yes     |

### stats

| Field                  | Type   | Default |
| ---------------------- | ------ | ------- |
| `downloads`            | int    | yes     |
| `downloaded`           | date   | yes     |
| `downloaded_by`        | string | yes     |
| `remote_downloads`     | int    | yes     |
| `remote_downloaded`    | date   | yes     |
| `remote_downloaded_by` | string | yes     |
| `remote_origin`        | string | yes     |
| `remote_path`          | string | yes     |

### item.infos

| Field               | Type   | Default |
| ------------------- | ------ | ------- |
| `props_modified`    | date   | yes     |
| `props_modified_by` | string | yes     |
| `props_md5`         | string | yes     |

### builds

| Field         | Type   | Default |
| ------------- | ------ | ------- |
| `url`         | string | yes     |
| `name`        | string | yes     |
| `number`      | string | yes     |
| `started`     | date   | yes     |
| `created`     | date   | yes     |
| `created_by`  | string | yes     |
| `modified`    | date   | yes     |
| `modified_by` | string | yes     |
| `repo`        | string | no      |

### modules

| Field  | Type   | Default |
| ------ | ------ | ------- |
| `name` | string | yes     |

### artifacts

| Field  | Type   | Default |
| ------ | ------ | ------- |
| `name` | string | yes     |
| `type` | string | yes     |
| `sha1` | string | yes     |
| `md5`  | string | yes     |

### dependencies

| Field   | Type   | Default |
| ------- | ------ | ------- |
| `name`  | string | yes     |
| `scope` | string | yes     |
| `type`  | string | yes     |
| `sha1`  | string | yes     |
| `md5`   | string | yes     |

### build.properties

| Field   | Type   | Default |
| ------- | ------ | ------- |
| `key`   | string | yes     |
| `value` | string | yes     |

### build.promotions

| Field        | Type   | Default |
| ------------ | ------ | ------- |
| `created`    | date   | yes     |
| `created_by` | string | yes     |
| `status`     | string | yes     |
| `repo`       | string | yes     |
| `comment`    | string | yes     |
| `user`       | string | yes     |

### module.properties

| Field   | Type   | Default |
| ------- | ------ | ------- |
| `key`   | string | yes     |
| `value` | string | yes     |

### releases

| Field          | Type                        | Default |
| -------------- | --------------------------- | ------- |
| `name`         | string                      | yes     |
| `version`      | string                      | yes     |
| `status`       | string                      | yes     |
| `created`      | date                        | yes     |
| `signature`    | string                      | yes     |
| `type`         | string (`SOURCE`, `TARGET`) | yes     |
| `storing_repo` | string                      | yes     |

### release_artifacts

| Field  | Type   | Default |
| ------ | ------ | ------- |
| `path` | string | yes     |

## Comparators

| Operator   | Meaning                          | Example                              |
| ---------- | -------------------------------- | ------------------------------------ |
| `$eq`      | Equals (default if omitted)      | `{"type":"file"}`                    |
| `$ne`      | Not equals                       | `{"type":{"$ne":"folder"}}`          |
| `$eqic`    | Equals, case-insensitive         | `{"name":{"$eqic":"README.md"}}`     |
| `$match`   | Wildcard match (`*`, `?`)        | `{"name":{"$match":"*.jar"}}`        |
| `$matchic` | Wildcard match, case-insensitive | `{"name":{"$matchic":"*.JAR"}}`      |
| `$nmatch`  | Wildcard not-match               | `{"name":{"$nmatch":"*-SNAPSHOT*"}}` |
| `$gt`      | Greater than                     | `{"size":{"$gt":"1000000"}}`         |
| `$gte`     | Greater than or equal            | `{"stat.downloads":{"$gte":"10"}}`   |
| `$lt`      | Less than                        | `{"size":{"$lt":"5000"}}`            |
| `$lte`     | Less than or equal               | `{"modified":{"$lte":"2025-01-01"}}` |

### Boolean operators

| Operator | Description                                                            |
| -------- | ---------------------------------------------------------------------- |
| `$and`   | All conditions must match (implicit when fields are at the same level) |
| `$or`    | Any condition must match                                               |

```
items.find({"$and":[
  {"repo":"my-repo"},
  {"$or":[
    {"name":{"$match":"*.jar"}},
    {"name":{"$match":"*.war"}}
  ]}
]})
```

### Relative date comparators

`$last` / `$before` for relative dates:

| Operator  | Meaning                                                 | Example                         |
| --------- | ------------------------------------------------------- | ------------------------------- |
| `$last`   | Within the last N period (equivalent to `$gt` from now) | `{"modified":{"$last":"7d"}}`   |
| `$before` | Before the last N period (equivalent to `$lt` from now) | `{"created":{"$before":"3mo"}}` |

Units: `d`, `w`, `mo`, `y`, `s`, `mi`, `ms`.

### Multi-property AND

Match property A=1 **and** B=2 (different property rows) with `$and` + `@`:

```
items.find({"$and":[
  {"@build.name":"my-build"},
  {"@build.number":"42"}
]})
```

`$msp` (multi-set property) is **unreliable in practice** — often 0 results
even when matches exist. Prefer `$and` + `@` (verified).

## Date queries

Absolute dates → ISO 8601:

```
items.find({"modified":{"$gt":"2025-06-01T00:00:00.000Z"}})
```

Or relative dates (preferred — no hardcoded timestamps):

```
items.find({"modified":{"$last":"30d"}})
items.find({"created":{"$before":"6mo"}})
```

## Property queries

Two equivalent property-filter syntaxes:

**`@key` shorthand** — concise, single property conditions:

```
items.find({"repo":"my-repo","@build.name":"my-build","type":"file"})
```

**Explicit form** — `property.key`/`property.value` pairs:

```
items.find({
  "repo":"my-repo",
  "property.key":"build.name",
  "property.value":"my-build"
})
```

**Multi-property AND** — same `$and` + `@` pattern as
[Multi-property AND](#multi-property-and) above (do not re-copy here).

> **Note:** The `@key` shorthand works inside `$and`. For `$or`, use the
> explicit `property.key`/`property.value` form if the shorthand does not
> return expected results.

## Include

Fields to return. No `.include()` → domain defaults.

**`.include()` replaces defaults — list every required field:**

- `items`: always `"repo","path","name"` (else server rejects)
- `builds`: always `"name","number","repo"`

```
items.find({"repo":"my-repo"})
  .include("name","repo","path","size","sha256","stat.downloads")
```

Cross-domain includes use dot-separated paths:

```
items.find({"repo":"my-repo"})
  .include("name","repo","path","property.key","property.value")
```

## Sort and pagination

```
items.find({"repo":"my-repo"})
  .sort({"$desc":["modified"]})
  .offset(0)
  .limit(50)
```

Sort: `$asc` / `$desc`. Sort fields must appear in the result set
(explicit `.include()` or defaults). See
[Before constructing a query](#before-constructing-a-query) for sort
performance rules.

## Distinct

Deduplicate rows:

```
items.find({"repo":"my-repo"}).distinct(true)
```

## Validation rules

Server constraints — violations → error:

**Non-admin:**

- `items` results must include `repo`, `path`, `name` (permission filtering)
- `builds` results must include `name`, `number`, `repo`

**Transitive** (`.transitive()` through virtual repos):

- `items` domain only
- Include subdomains limited to `items` and `properties`
- Repo criteria: `$eq` only, single repository
- No `offset` or `sort`

## Before constructing a query

Checks before writing AQL:

1. **Never `.sort()` without a `repo` filter** — full table scan. Sort
   client-side with `jq`. Cross-domain sort fields (e.g. `stat.downloads` in
   `items.find()`) are silently ignored — fetch all + sort client-side.
2. **Always `.limit()`** — no default; unbounded queries can time out / OOM.
   Broad queries without `repo` are especially expensive.
3. **`range.total` = returned count, not total matching** — no count-only
   mode. True total → paginate `.offset()` until a page returns fewer than
   the limit.
4. **No repo-type field** — local-only: pre-query
   `GET /api/repositories?type=local` and add names to criteria (small lists),
   or query without repo filter and drop `-cache`/`-virtual` via `jq`.
5. **Narrow server-side first** — add every applicable filter (`created_by`,
   `created`, `type`, `name`) before client-side `jq`.

## Common query patterns

### Find all JARs in a repo

```
items.find({"repo":"libs-release","name":{"$match":"*.jar"}})
```

### Find large files (> 100 MB)

```
items.find({"repo":"my-repo","size":{"$gt":"104857600"},"type":"file"})
```

### Find Maven SNAPSHOT JARs

Use `*-SNAPSHOT*.jar` (not `*-SNAPSHOT.jar`) to also match classifiers
(`-sources.jar`, `-javadoc.jar`):

```
items.find({"repo":"libs-snapshot","name":{"$match":"*-SNAPSHOT*.jar"},"type":"file"})
```

### Find artifacts modified in the last 7 days

```
items.find({"repo":"my-repo","modified":{"$last":"7d"},"type":"file"})
  .sort({"$desc":["modified"]})
  .limit(100)
```

### Docker queries

`"name":"manifest.json"` → **list tags** (one per tag).
`"name":{"$match":"*manifest.json"}` → **all manifests** (includes
`list.manifest.json` for multi-arch — see [Gotchas](#gotchas)).

```
items.find({"repo":"docker-local","path":{"$match":"my-image/*"},"name":"manifest.json"})
```

### Docker image size

**Do not use AQL** — layer blobs live at `<image>/sha256:<digest>/`, not
under `<image>/<tag>/`. Use the V2 manifest API (returns `layers[].size`):

```bash
jf api "/artifactory/api/docker/<repo>/v2/<image>/manifests/<tag>" \
  -H "Accept: application/vnd.docker.distribution.manifest.v2+json"
```

For multi-arch: response is an image index — fetch each platform manifest
by digest for layers.

### Find artifacts with a specific property

See [Property queries](#property-queries) (`@key` shorthand and explicit form).

### Find never-downloaded files (zero download count)

Zero-download items lack a stats row — filter client-side
(see [Gotchas](#gotchas)):

```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" -d '
items.find({"repo":"my-repo","type":"file"})
  .include("repo","path","name","size","stat.downloads")
' | jq '[.results[] | select((.stats[0].downloads // 0) == 0) | {repo, path, name, size}]'
```

### Find artifacts not downloaded in 90 days

Only previously-downloaded items (see [Gotchas](#gotchas)). Combine with
never-downloaded pattern above for full coverage.

```
items.find({
  "repo":"my-repo",
  "type":"file",
  "stat.downloaded":{"$before":"90d"}
}).include("name","repo","path","stat.downloaded","size")
```

### Find items by build name (cross-domain)

```
items.find({"artifact.module.build.name":"my-service"})
  .include("name","repo","path","artifact.module.build.number")
  .sort({"$desc":["modified"]})
  .limit(50)
```

### Find builds by name

Non-admin must include `name`, `number`, `repo` — omit any → error.

```
builds.find({"name":{"$match":"*my-service*"}})
  .include("name","number","repo","started")
  .sort({"$desc":["started"]})
  .limit(10)
```

### Find build artifacts

```
artifacts.find({"module.build.name":"my-service","module.build.number":"42"})
  .include("name","type","sha1","md5")
```

### Find build dependencies

```
dependencies.find({"module.build.name":"my-service","module.build.number":"42"})
  .include("name","scope","type","sha1")
```

### Remote repository content

Remote artifacts live in a `-cache` suffixed repo. Query the cache, not the
remote itself:

```
items.find({"repo":"npm-remote-cache","name":{"$match":"*.tgz"}})
```

## Gotchas

- The request body is **plain text**, not JSON — use
`Content-Type: text/plain`.
- String values in criteria must be quoted, including numeric comparisons
(`"size":{"$gt":"1000"}` not `"size":{"$gt":1000}`).
- Remote repo content lives in `<repo>-cache`, not `<repo>`.
- Sort fields must appear in the result set (included explicitly or by
default).
- Non-admin `items` queries must return `repo`, `path`, `name`.
- Non-admin `builds` queries must return `name`, `number`, `repo`.
- Items connect to builds through checksum matching (SHA-1), so cross-domain
queries between items and builds are valid but traverse multiple joins.
- The `path` value for items at the **root** of a repository is `"."`, not
`""` or `"/"`. Use `"path":"."` to match root-level files.
- **Docker `list.manifest.json`** — multi-arch images store two manifest files per
  tag: `manifest.json` (platform-specific manifest) and `list.manifest.json` (OCI
  image index). Filtering by `"name":"manifest.json"` is correct for tag listing
  (one result per tag), but silently excludes `list.manifest.json` entries. Use
  `"name":{"$match":"*manifest.json"}` when querying by uploader, date range, or
  any context where all manifest pushes should be counted.
- **`stat.downloads` filters do not match zero-download items** — never-downloaded
  items lack a stats row so the join finds nothing. Use the client-side `jq`
  approach in "Find never-downloaded files" above.
- `$match` uses SQL-style wildcards: `*` matches any characters, `?` matches
exactly one character. It is **not** regex. Literal `_` and `%` in patterns
are escaped automatically.
- The `builds.number` field is a **string**, not an integer. Build numbers
like `"42"`, `"1.0.3"`, and `"SNAPSHOT-1"` are all valid.
- Release bundle `type` values are uppercase strings: `"SOURCE"` or
`"TARGET"`.
- Dates accept both ISO 8601 format (`"2025-06-01T00:00:00.000Z"`) and
epoch milliseconds as a string (`"1719792000000"`).
- The server silently excludes trash, support-bundle, and in-transit
repository content from AQL results. If an item exists but doesn't appear
in results, it may be in one of these hidden repos.
- Virtual repo queries are rewritten to search the underlying physical repos.
The `repo` field in results shows the physical repo name, not the virtual
repo name you queried.

## Official documentation

- https://docs.jfrog.com/artifactory/docs/artifactory-query-language
- https://docs.jfrog.com/artifactory/docs/aql-syntax
- https://docs.jfrog.com/artifactory/docs/aql-search-criteria
- https://docs.jfrog.com/artifactory/docs/aql-entities-fields-reference
- https://docs.jfrog.com/artifactory/docs/aql-query-output
- https://docs.jfrog.com/artifactory/docs/aql-query-execution
- https://docs.jfrog.com/artifactory/docs/aql-examples
- https://docs.jfrog.com/artifactory/docs/aql-repository-queries
- https://docs.jfrog.com/artifactory/docs/aql-performance

