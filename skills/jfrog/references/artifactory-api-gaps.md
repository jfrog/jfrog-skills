# Artifactory API Gaps

Operations available through REST API but not through CLI commands.
Invoke them via `jf api <path> [flags]` (authentication is handled
automatically against the active `jf config` server; see the base skill's
*Invoking platform APIs with `jf api`* section).

## Repository management

### Get repository configuration
```bash
jf api /artifactory/api/repositories/<repo-key>
```
Returns the full JSON configuration of a repository. Useful as a template
for creating similar repos.

### List all repositories
```bash
jf api /artifactory/api/repositories
```
Optional query params (combinable): `type` (one of `local`, `remote`,
`virtual`, `federated`), `packageType` (e.g. `docker`, `maven`, `npm`,
`pypi`, `generic`), `project`. Examples:
```bash
jf api "/artifactory/api/repositories?type=local"
jf api "/artifactory/api/repositories?packageType=docker"
jf api "/artifactory/api/repositories?type=remote&packageType=maven&project=my-project"
```

### Get repositories (v2)
```bash
jf api /artifactory/api/repositories/configurations
```
Optional query params (combinable, comma-separated values allowed):
`repoType` (case-insensitive; one of `local`, `remote`, `virtual`,
`federated`) and `packageType` (e.g. `maven`, `docker`, `npm`). Note:
`repo_type` is silently ignored — the correct name is `repoType`.
Examples:
```bash
jf api "/artifactory/api/repositories/configurations?repoType=local"
jf api "/artifactory/api/repositories/configurations?packageType=maven"
jf api "/artifactory/api/repositories/configurations?repoType=local,remote&packageType=docker"
```

### Check if repository exists
```bash
jf api /artifactory/api/repositories/<repo-key> -X HEAD
# 200 = exists, 400 = does not exist
```

## Storage and system

### Get storage summary
```bash
jf api /artifactory/api/storageinfo
```

### Refresh storage summary
```bash
jf api /artifactory/api/storageinfo/calculate -X POST
```

### Get storage item info
```bash
jf api "/artifactory/api/storage/<repo>/<path>"
```

### System ping
```bash
jf api /artifactory/api/system/ping
```

### System version
```bash
jf api /artifactory/api/system/version
```

### System configuration
```bash
jf api /artifactory/api/system/configuration
```

## Search (beyond CLI)

### AQL queries
```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" \
  -d 'items.find({"repo":"my-repo","name":{"$match":"*.jar"}})'
```

For remote repository content, query the `-cache` suffixed repo:
```bash
jf api /artifactory/api/search/aql \
  -X POST -H "Content-Type: text/plain" \
  -d 'items.find({"repo":"my-remote-cache"})'
```

### Property search
```bash
jf api "/artifactory/api/search/prop?key=value&repos=my-repo"
```

### Checksum search
```bash
jf api "/artifactory/api/search/checksum?sha256=<sha256>"
```

### GAVC search (Maven)
```bash
jf api "/artifactory/api/search/gavc?g=com.example&a=mylib&v=1.0"
```

## User and group management

User and group operations are handled by the Access service. See
`platform-admin-api-gaps.md` (Users / Groups sections) for the full set.

## Metadata calculation

Trigger metadata recalculation for various package types:
```bash
# Maven
jf api /artifactory/api/maven/calculateMetaData/<repo-key> -X POST

# npm
jf api /artifactory/api/npm/<repo-key>/reindex -X POST

# Docker
# (automatic, no manual trigger)

# PyPI
jf api /artifactory/api/pypi/<repo-key>/reindex -X POST

# Helm
jf api /artifactory/api/helm/<repo-key>/reindex -X POST

# Debian
jf api /artifactory/api/deb/reindex/<repo-key> -X POST
```

## Trash can and garbage collection

### Empty trash
```bash
jf api /artifactory/api/trash/empty -X POST
```

### Restore from trash
```bash
jf api "/artifactory/api/trash/restore/<repo>/<path>" -X POST
```

### Run garbage collection
```bash
jf api /artifactory/api/system/storage/gc -X POST
```

## Federated repositories (beyond basic CRUD)

### Get federation status
```bash
jf api /artifactory/api/federation/status/<repo-key>
```

### Trigger full sync
```bash
jf api "/artifactory/api/federation/fullSyncAll/<repo-key>" -X POST
```

## Build info (beyond CLI)

### List builds (prefer scoped queries)

**Unscoped** `GET /artifactory/api/build` (no query parameters) can **time
out** on busy instances. Prefer **project-scoped** or **repo-scoped**
listing, then detail GETs. Full flow: read `artifactory-operations.md`
§ *Listing builds when the project key is known*.

```bash
# Project scope — build names (latest per name)
jf api "/artifactory/api/build?project=<project-key>"

# Project scope — all run numbers for one build name (response: buildsNumbers)
jf api "/artifactory/api/build/<build-name>?project=<project-key>"

# Build-info repo scope — alternative when you know the repo key
jf api "/artifactory/api/build?buildRepo=<build-info-repo-key>"
```

### Get build info
```bash
# Default build-info repo only (no project / non-default repo)
jf api "/artifactory/api/build/<build-name>/<build-number>"

# Project or custom build-info repo
jf api "/artifactory/api/build/<build-name>/<build-number>?project=<project-key>"
jf api "/artifactory/api/build/<build-name>/<build-number>?buildRepo=<build-info-repo-key>"
```

### Delete builds
```bash
jf api /artifactory/api/build/delete \
  -X POST -H "Content-Type: application/json" \
  -d '{"buildName":"my-build","buildNumbers":["1","2"]}'
```
