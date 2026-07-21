# `.jfrog/local/package-resolution.json` — Workspace Binding File

This skill records workspace repo bindings in a file the session-start hook
reads to override org defaults from `~/.jfrog/skills-cache/package-resolution.json`.

The file is the **decisions** record, not a credential store. Tokens live
in `jf config` and in PM-native files written by `jf setup` itself.

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

### PM name → package type (when merging after `jf setup`)

| `jf setup` PM | `repositories` key |
|---|---|
| `npm`, `yarn`, `pnpm` | `npm` |
| `pip`, `pipenv`, `poetry`, `twine` | `pypi` |
| `maven`, `gradle` | `maven` |
| `go` | `go` |
| `docker`, `podman` | `docker` |
| `helm` | `helm` |
| `nuget`, `dotnet` | `nuget` |

## Operations

### 1. Load

Before setup, **read** the file (if it exists). For each PM in the
to-bind set, map the PM to a package type and compare
`repositories.<type>` against what the resolver chose in Step 2:

| Case | Action |
|---|---|
| Missing type in `repositories` | Run `jf setup` and merge in Step 6. |
| Same repo key | **Skip** `jf setup` — hook already applies overrides on session start. |
| Different repo key | Show diff and confirm via AskQuestion before overwriting. |

### 2. Write / merge

After each successful `jf setup`:

1. Read the current file (treat ENOENT as `{ "repositories": {} }`).
2. Set `repositories[<pkgType>] = <repoKey>` using the PM → type table above.
3. Atomically write `{ "repositories": { ... } }` — preserve other package
   types already in the map.

JSON must use 2-space indent.

### 3. Never write

- Credentials (`accessToken`, passwords, …).
- PM-native config paths — those are owned by `jf setup`.

## Integration contract

| Consumer | What it reads |
|---|---|
| Session-start hook | `repositories` — first workspace root with this file (multi-root) |
| This skill | Round-trip load → diff → confirm → write |
| `opencode-jfrog-plugin` | **Not updated** — out of scope until it reads this file |

Changing the `repositories` key semantics is a breaking change; coordinate
with the hook before altering them.
