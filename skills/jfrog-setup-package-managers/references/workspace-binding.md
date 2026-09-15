# `.jfrog/local/package-resolution.json` — Workspace Binding File

This skill records workspace repo bindings in a file the session-start hook
reads to override org defaults from `~/.jfrog/skills-cache/package-resolution.json`.

The file is the **decisions** record, not a credential store. Tokens live
in `jf config` and in package-manager-native files written by `jf setup` itself.

## Location

```
<workspace-root>/.jfrog/local/package-resolution.json
```

`<workspace-root>` is the directory the user opened in the IDE — **not**
`$HOME`. Workspace-scoped on purpose: different projects can override
different Artifactory repos.

## Schema

```json
{
  "repositories": {
    "npm": "<repository-key>",
    "pypi": "<repository-key>",
    "maven": "<repository-key>",
    "gradle": "<repository-key>",
    "go": "<repository-key>",
    "docker": "<repository-key>",
    "helm": "<repository-key>",
    "nuget": "<repository-key>"
  }
}
```

| Field | Required | Description |
|---|---|---|
| `repositories` | yes | Map keyed by **package type** — same keys as `servers.<serverId>.repositories` in the global resolver cache. Omit package types you do not override. |

### Package-manager name → package type (when merging after `jf setup`)

Aligned with Agent Package Resolution (`PACKAGE_TYPES` / eager families).
`gradle` is its **own** Artifactory package type — never fold it under `maven`.

| `jf setup` package manager | `repositories` key |
|---|---|
| `npm`, `pnpm` | `npm` |
| `yarn` | `npm` (CLI may still accept `jf setup yarn`; APR zero-touch does **not** auto-setup yarn — only bind on explicit user request) |
| `pip`, `pipenv`, `uv`, `twine` | `pypi` |
| `poetry` | `pypi` (CLI may accept it; APR zero-touch does **not** auto-setup poetry — bind only on explicit user request) |
| `maven` | `maven` |
| `gradle` | `gradle` |
| `go` | `go` |
| `docker`, `podman` | `docker` |
| `helm` | `helm` |
| `nuget`, `dotnet` | `nuget` |

## Operations

### 1. Load

Before setup, **read** the file (if it exists). For each package manager in the
to-bind set, map it to a package type and compare
`repositories.<type>` against what the resolver chose in Step 2:

| Case | Action |
|---|---|
| Missing type in `repositories` | Run `jf setup` and merge in Step 6. |
| Same repo key | **Skip** `jf setup` — hook already applies overrides on session start. |
| Different repo key | Show diff and confirm via AskQuestion before overwriting. |

### 2. Write / merge

After each successful `jf setup`, run the skill script (do **not** hand-edit
JSON):

```bash
bash <skill_path>/scripts/merge-workspace-binding.sh \
  --package-manager <package-manager> \
  --repo <repoKey> \
  [--workspace-root <workspace-root>]
```

The script:

1. Maps `--package-manager` → package type using the table above (unknown PM → exit 1).
2. Validates `--repo` (`^[A-Za-z0-9._-]+$`).
3. Reads the current file (ENOENT → empty `repositories`).
4. Sets `repositories[<pkgType>] = <repoKey>`, preserve other package types, **last write wins** for the same type.
5. Writes `{ "repositories": { ... } }` only (drops other top-level keys), 2-space indent, atomic replace via `mktemp` + `mv`.
6. Serializes concurrent merges with a workspace **directory** lock (`package-resolution.lock.d`; symlink-safe; reclaim when owner PID is dead on this host or the owner hostname differs; owner-less lock dirs are **not** reclaimed — `mkdir` is the mutex; reclaimers take an exclusive side-gate so a late reclaim cannot delete a newly acquired lock).
7. On corrupt/invalid existing JSON → exit 1 and **leaves the file untouched**.
8. Requires `jq`; if missing → exit 1.

### 3. Never write

- Credentials (`accessToken`, passwords, …).
- Package-manager-native config paths — those are owned by `jf setup`.

## Integration contract

| Consumer | What it reads |
|---|---|
| Session-start hook | `repositories` — first workspace root with this file (multi-root) |
| This skill | Round-trip load → diff → confirm → `merge-workspace-binding.sh` |
| `opencode-jfrog-plugin` | **Not updated** — out of scope until it reads this file |

Changing the `repositories` key semantics is a breaking change; coordinate
with the hook before altering them.
