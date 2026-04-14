# Artifactory API Gaps

Operations available through REST API but not through CLI commands.
Use `jf rt curl` for all of these (handles authentication automatically).

## Repository management

### Get repository configuration
```bash
jf rt curl -XGET /api/repositories/<repo-key>
```
Returns the full JSON configuration of a repository. Useful as a template
for creating similar repos.

### List all repositories
```bash
jf rt curl -XGET /api/repositories
# Filter by type, package type, and/or project (all combinable)
jf rt curl -XGET "/api/repositories?type=local"
jf rt curl -XGET "/api/repositories?type=remote"
jf rt curl -XGET "/api/repositories?type=virtual"
jf rt curl -XGET "/api/repositories?packageType=docker"
jf rt curl -XGET "/api/repositories?project=myproj"
jf rt curl -XGET "/api/repositories?project=myproj&type=local&packageType=docker"
```

### Get repositories (v2)
```bash
jf rt curl -XGET "/api/repositories/configurations?repo_type=LOCAL&package_type=maven"
```

### Check if repository exists
```bash
jf rt curl -XHEAD /api/repositories/<repo-key>
# 200 = exists, 400 = does not exist
```

## Storage and system

### Get storage summary
```bash
jf rt curl -XGET /api/storageinfo
```

### Refresh storage summary
```bash
jf rt curl -XPOST /api/storageinfo/calculate
```

### Get storage item info
```bash
jf rt curl -XGET "/api/storage/<repo>/<path>"
```

### System ping
```bash
jf rt curl -XGET /api/system/ping
```

### System version
```bash
jf rt curl -XGET /api/system/version
```

### System configuration
```bash
jf rt curl -XGET /api/system/configuration
```

## Search (beyond CLI)

### AQL queries
```bash
jf rt curl -XPOST /api/search/aql \
  -H "Content-Type: text/plain" \
  -d 'items.find({"repo":"my-repo","name":{"$match":"*.jar"}})'
```

For remote repository content, query the `-cache` suffixed repo:
```bash
jf rt curl -XPOST /api/search/aql \
  -H "Content-Type: text/plain" \
  -d 'items.find({"repo":"my-remote-cache"})'
```

### Property search
```bash
jf rt curl -XGET "/api/search/prop?key=value&repos=my-repo"
```

### Checksum search
```bash
jf rt curl -XGET "/api/search/checksum?sha256=<sha256>"
```

### GAVC search (Maven)
```bash
jf rt curl -XGET "/api/search/gavc?g=com.example&a=mylib&v=1.0"
```

## User management (beyond CLI)

These Access API endpoints are routed through Artifactory's auth proxy via
`jf rt curl`. The same endpoints can also be reached with plain `curl` and
extracted credentials — see `platform-admin-api-gaps.md` (Users section).

### Get user details
```bash
jf rt curl -XGET /access/api/v2/users/<username>
```

### Update user
```bash
jf rt curl -XPATCH /access/api/v2/users/<username> \
  -H "Content-Type: application/json" \
  -d '{"email": "new@example.com"}'
```

### List all users
```bash
jf rt curl -XGET /access/api/v2/users/
```

### Get group details
```bash
jf rt curl -XGET /access/api/v2/groups/<groupname>
```

## Metadata calculation

Trigger metadata recalculation for various package types:
```bash
# Maven
jf rt curl -XPOST /api/maven/calculateMetaData/<repo-key>

# npm
jf rt curl -XPOST /api/npm/<repo-key>/reindex

# Docker
# (automatic, no manual trigger)

# PyPI
jf rt curl -XPOST /api/pypi/<repo-key>/reindex

# Helm
jf rt curl -XPOST /api/helm/<repo-key>/reindex

# Debian
jf rt curl -XPOST /api/deb/reindex/<repo-key>
```

## Trash can and garbage collection

### Empty trash
```bash
jf rt curl -XPOST /api/trash/empty
```

### Restore from trash
```bash
jf rt curl -XPOST "/api/trash/restore/<repo>/<path>"
```

### Run garbage collection
```bash
jf rt curl -XPOST /api/system/storage/gc
```

## Federated repositories (beyond basic CRUD)

### Get federation status
```bash
jf rt curl -XGET /api/federation/status/<repo-key>
```

### Trigger full sync
```bash
jf rt curl -XPOST "/api/federation/fullSyncAll/<repo-key>"
```

## Build info (beyond CLI)

### List builds (prefer scoped queries)

**Unscoped** `GET /api/build` (no query parameters) can **time out** on busy
instances. Prefer **project-scoped** or **repo-scoped** listing, then detail
GETs. Full flow: read `artifactory-operations.md` § *Listing builds when the
project key is known*.

```bash
# Project scope — build names (latest per name)
jf rt curl -XGET "/api/build?project=<project-key>"

# Project scope — all run numbers for one build name (response: buildsNumbers)
jf rt curl -XGET "/api/build/<build-name>?project=<project-key>"

# Build-info repo scope — alternative when you know the repo key
jf rt curl -XGET "/api/build?buildRepo=<build-info-repo-key>"
```

### Get build info
```bash
# Default build-info repo only (no project / non-default repo)
jf rt curl -XGET "/api/build/<build-name>/<build-number>"

# Project or custom build-info repo
jf rt curl -XGET "/api/build/<build-name>/<build-number>?project=<project-key>"
jf rt curl -XGET "/api/build/<build-name>/<build-number>?buildRepo=<build-info-repo-key>"
```

### Delete builds
```bash
jf rt curl -XPOST /api/build/delete \
  -H "Content-Type: application/json" \
  -d '{"buildName":"my-build","buildNumbers":["1","2"]}'
```
