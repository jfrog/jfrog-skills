---
name: jfrog-package-safety-and-download
description: >-
  Check JFrog Public Catalog and stored packages for a version, interpret
  catalog security signals, and download through Artifactory (Jfrog Platform
  locations, remote cache, curation-aware package managers, or repo proxy).
  Use when the user asks whether a package is safe, allowed, curated, or
  wants to download npm, Maven, PyPI, Go, or similar packages via JFrog.
  Do NOT use for pure CVE or vulnerability lookups (e.g. "details on
  CVE-2021-23337") — those are handled by the jfrog skill's Public security
  domain queries without this workflow.
metadata:
  role: workflow
---

# JFrog Package Safety and Download

## Prerequisites

- Read `../jfrog/SKILL.md` for JFrog Platform concepts, domain model, CLI setup, and API patterns.
- **OneModel shapes drift by server version.** Before inventing GraphQL fields or `where` filters, read `../jfrog/references/onemodel-graphql.md` (schema fetch workflow) and `../jfrog/references/onemodel-query-examples.md` (**Public packages**, **Stored packages**). Regenerate or verify queries against `GET "$JFROG_URL/onemodel/api/v1/supergraph/schema"` when examples fail validation.

## Workflow

# Package safety check and download workflow

When to read this file:

- User asks to **check if a package is safe** and/or **download** it.
- User asks to **download a package** from Artifactory.
- User mentions checking a package for **curation** approval.
- User wants to know if a package is **allowed** or **approved** for use.

## Workflow overview

```mermaid
flowchart TD
    A[User requests package check / download] --> B{Package in Public Catalog?}
    B -->|Yes| C[Get latest version from Catalog]
    B -->|No| D{Package in Jfrog Platform Stored Packages?}
    D -->|Yes| E[Get latest version from Stored Packages]
    D -->|No| F[Package not found — stop]
    C --> G{Latest version in Jfrog Platform?}
    E --> G
    G -->|Yes| H[Safe — download from Jfrog Platform]
    G -->|No| I{Curation entitled?}
    I -->|Yes| J[Check curation policy via API]
    I -->|No| K[Download via remote repo]
    J -->|200 Allowed| K
    J -->|403 Blocked| M[Report curation blocked — stop]
```

### Parallelization opportunities

Several steps in this workflow are independent and can run in parallel to
reduce total latency:

- **Step 1 + Step 1 fallback**: When package type is known, query both the
  Public Catalog (`getPackage`) and Stored Packages (`getPackage`) in
  parallel. Use whichever returns data; if the Public Catalog returns a hit,
  prefer its `latestVersion` for Step 2.
- **Step 3 + Step 5**: After determining the version, query stored package
  versions (Jfrog Platform check) and curation entitlement
  (`/api/system/version`) in parallel. Both are independent reads — the
  curation result is needed immediately if the Jfrog Platform check returns
  empty.

When issuing parallel Shell calls, remember that credentials don't persist
across calls — use the jfrog skill to obtain the platform URL and credentials
in each parallel call.

## Step 1: Find the package

Search the **Public Catalog** first via OneModel GraphQL, then fall back to
**Stored Packages** if not found.

Use the jfrog skill for credentials (Tier 3) and the GraphQL execution
pattern. Refer to `../jfrog/references/onemodel-query-examples.md` for query
shapes.

**When package type is known** (e.g. `npm`, `maven`, `pypi`), use
`publicPackages.getPackage(type:, name:)` (see *Get a public package*).
Include the `latestVersion { version }` selection set — `latestVersion` is
an object, not a scalar.

**When type is unknown**, use `publicPackages.searchPackages` with
`nameContains` (see *Search public packages*). Add `type:` when the user
narrows the ecosystem.

- **Found** → note `type` and `latestVersion.version`. Proceed to Step 2.
- **Not found** → the package may be 1st/2nd party. Search **Stored Packages**
  using `storedPackages.searchPackages` or `storedPackages.getPackage` (see
  *Stored packages domain* in `onemodel-query-examples.md`). Prefer
  filtering by `type` when known; if not, use `nameContains` alone.
  - **Found** → note `type` and `latestVersionName` (or derive a version from
    `versionsConnection`). Proceed to Step 2.
  - **Not found in either** → report "package not found" and stop.

If multiple results with different `type` values, ask the user which package
type they mean.

## Step 2: Determine latest version

| Source | Version field |
|--------|--------------|
| Public Catalog | `latestVersion.version` (object selection required) |
| Jfrog Platform Stored Packages | `latestVersionName` on `StoredPackage`, or highest entry from `versionsConnection` |

## Step 3: Check if package + latest version exists in Jfrog Platform

Query stored package versions using `storedPackages.searchPackageVersions`
with a `hasPackageWith` filter (see `../jfrog/references/onemodel-query-examples.md`
→ *Search stored package versions*). Add a `version` filter for the specific
version from Step 2, and request `locationsConnection` to get repository
details (`repositoryKey`, `repositoryType`, `leadArtifactPath`).

Use the jfrog skill for credentials and GraphQL execution.

- **Found with locations** → package is in the Jfrog Platform. Report as **safe to
  download**. Proceed to Step 4.
- **Not found** → proceed to Step 5.

## Step 4: Download from Jfrog Platform

Use the location info from Step 3. Download command depends on repository
type. **`<target>` must be a full file path** (e.g.
`./downloads/lodash-4.18.1.tgz`), not a bare directory. `jf rt dl --flat`
treats the target as a file name; passing a directory causes a misleading
"open path: is a directory" error.

| `repositoryType` | Strategy |
|-------------------|----------|
| `local` or `federated` | Use `jf rt dl` — the artifact is stored locally and will always be found |
| `remote` | Use the proxy endpoint directly — `jf rt dl` only finds already-cached artifacts and returns 0 for uncached packages, wasting an API call |

**local / federated download:**

```bash
jf rt dl "<repositoryKey>/<leadArtifactPath>" <target-file> --flat
```

**remote download — go straight to the proxy endpoint:**

```bash
jf rt curl -s -L -XGET "/api/<protocol>/<remoteRepoKey>/<artifact-path>" \
  -o <output-file>
```

**Resolving the remote repo key for the proxy endpoint:** The `repositoryKey`
returned by OneModel for remote locations often already ends in `-cache` (e.g.
`devNPM-remote-cache`). The proxy endpoint needs the **base remote repo name**
(without `-cache`). Strip the `-cache` suffix when present (e.g.
`devNPM-remote-cache` → `devNPM-remote`). If the key does not end in `-cache`,
use it as-is.

See the **Protocol endpoints** table below for `<protocol>` and path format.

## Step 5: Check curation entitlement

```bash
jf rt curl -s -XGET /api/system/version | jq '.addons | index("curation") != null'
```

- `true` → curation is entitled. Proceed to Step 6a.
- `false` → curation not available. Proceed to Step 6b.

## Step 6a: Check curation policy and download

When curation is entitled, use the Xray curation API to check whether the
package version is allowed across all repositories before downloading.

```bash
RESPONSE_FILE="/tmp/curation-status-$$.json"
jf xr curl -s -XPOST "/api/v1/curation/package_status/all_repos" \
  -H "Content-Type: application/json" \
  -d "{\"packageType\":\"<TYPE>\",\"packageName\":\"<NAME>\",\"packageVersion\":\"<VERSION>\"}" \
  -o "$RESPONSE_FILE" -w "\n%{http_code}"
echo "$RESPONSE_FILE"
```

Supported `packageType` values: `npm`, `pypi`, `maven`, `go`, `nuget`,
`docker`, `gradle`.

To capture both the response body and the HTTP status code in one call, use
`-w "\n%{http_code}"` and parse the last line as the status code:

```bash
HTTP_CODE=$(tail -1 "$RESPONSE_FILE")
BODY=$(sed '$d' "$RESPONSE_FILE")
if [ "$HTTP_CODE" = "403" ]; then
  echo "Blocked by curation policy:"
  echo "$BODY"
elif [ "$HTTP_CODE" = "200" ]; then
  echo "Package is allowed by curation."
fi
```

**Evaluate the HTTP status code:**

- **200** → package is **allowed** by curation policy. Proceed to download
  via a remote repo (same as Step 6b).
- **403** → package is **blocked** by a curation policy. The response body
  explains which policy rule blocked it. Report the block reason to the user
  and stop — do not attempt to download.

## Step 6b: Download without curation

When curation is not entitled and the package is not in the Jfrog Platform,
download directly through a remote repo.

1. **Find a remote repo** of the right package type:

   ```bash
   jf rt curl -s -XGET "/api/repositories?type=remote&packageType=<TYPE>" \
     | jq '.[].key'
   ```

2. **Download:**

   ```bash
   jf rt dl "<repo>-cache/<artifact-path>" <target-file> --flat
   ```

   If 0 results (not cached), fetch through the remote proxy:

   ```bash
   jf rt curl -s -L -XGET "/api/<protocol>/<repo>/<artifact-path>" \
     -o <output-file>
   ```

## Protocol endpoints by package type

| Type | Protocol prefix | Artifact path pattern |
|------|----------------|----------------------|
| `npm` | `/api/npm/<repo>` | `<pkg>/-/<pkg>-<version>.tgz` |
| `pypi` | `/api/pypi/<repo>/packages` | `<pkg>/<version>/<pkg>-<version>.tar.gz` |
| `maven` | `/<repo>` | `<group-path>/<artifact>/<version>/<artifact>-<version>.jar` |
| `go` | `/api/go/<repo>` | `<module>/@v/<version>.zip` |

## Gotchas

- **`jf rt dl` and remote repos**: `jf rt dl` only finds artifacts already
  present in the `-cache` repo. For `remote` repository types, Step 4
  instructs to skip `jf rt dl` entirely and use the proxy endpoint directly,
  avoiding a wasted round-trip for uncached packages.
- **Redirects**: `jf rt curl` does not follow HTTP redirects by default.
  Always pass `-L` when downloading binary artifacts through remote repo
  proxy endpoints.
- **`jf rt dl --flat` target must be a file path**: When downloading a
  single artifact, pass a full output **file** path (e.g.
  `./downloads/lodash-4.18.1.tgz`), not a directory. The CLI opens the target
  path as a file; a directory causes a cryptic "open path: is a directory"
  error that retries four times before failing. Derive the filename from
  `leadArtifactPath` (take the segment after the last `/`).
- **Package type detection**: If the user doesn't specify the package type,
  the Public Catalog search by name alone may return multiple types. Ask the
  user to disambiguate before proceeding.
- **Curation API uses `jf xr curl`**: The curation package status endpoint
  is under Xray, not Artifactory. Use `jf xr curl`, not `jf rt curl`.
- **Curation API package type values**: Must be lowercase and match one of
  `npm`, `pypi`, `maven`, `go`, `nuget`, `docker`, `gradle`. Other values
  will return an error.
