# `package-resolution.json` — Global Resolver Cache

The session-start hook runs a small resolver that picks the Artifactory
repository key per package type for the current JFrog server and caches
the result in:

```
~/.jfrog/skills-cache/package-resolution.json
```

This skill **reads** that file in Step 2 to recover the repo key per PM
without re-doing discovery. The file is the canonical, machine-readable
mirror of the "Resolved URLs for this session" table that the hook
injects into agent context — the latter can be trimmed by long-context
pruning, the file cannot.

> This is a **read-only contract** for this skill. The cache is written by
> the session-start hook; never write or hand-edit it.

> **Not** the workspace binding file — that lives at
> `.jfrog/local/package-resolution.json` (see [`workspace-binding.md`](workspace-binding.md)).

## Shape

```json
{
  "schemaVersion": 1,
  "servers": {
    "<serverId>": {
      "repositories": {
        "npm":   "npm-virtual",
        "pypi":  "pypi-virtual",
        "maven": "libs-release",
        "gradle":"gradle-virtual",
        "go":    "go-virtual",
        "docker":"docker-virtual",
        "helm":  "helm-virtual",
        "nuget": "nuget-virtual"
      },
      "cached_at": "2026-05-27T09:30:00Z",
      "source": "verified",
      "agentsConfigMtimeMs": 1719158400000
    }
  }
}
```

Each `servers.<serverId>` entry holds `repositories`, `cached_at`, `source`, and
`agentsConfigMtimeMs` (mtime of `~/.jfrog/agents-conf.json` at last refresh).
The workspace binding file at
[`.jfrog/local/package-resolution.json`](workspace-binding.md) holds
only `repositories`. The map key **is** the `serverId`.

| Field | Meaning |
|---|---|
| `schemaVersion` | Always `1` for this schema. |
| `servers.<serverId>.repositories.<pkgType>` | Resolver's chosen repo key for this package type, on this server. **Missing key = `unresolved`** for that package manager. |
| `servers.<serverId>.cached_at` | ISO-8601 timestamp of the last refresh. TTL from `packageResolution.cacheTtlDays` in agents-conf.json (default 7). |
| `servers.<serverId>.agentsConfigMtimeMs` | Invalidates cache when `~/.jfrog/agents-conf.json` changes. |
| `servers.<serverId>.source` | `verified` = keys from agents-conf.json checked via `GET /api/repositories/{key}`; `agents-config` = trusted without HTTP (`verifyRepos: false`). |

Package type keys used in the file are `npm`, `pypi`, `maven`, `gradle`, `go`,
`docker`, `helm`, `nuget`. Note `pypi` (not `pip`) — same convention the
JFrog API uses. The package-manager names accepted by `jf setup` (`pip`, `uv`,
`pnpm`, `podman`, `dotnet`, `pipenv`, `twine`, and optionally `yarn` / `poetry`
when the user asks) collapse onto these package-type keys — **`gradle` maps to
`gradle`**, not `maven`.


## Three result classes per package manager

When you look up a package manager in this file, you get one of:

| Class | Detect | What the resolver did | HTTP-verified? |
|---|---|---|---|
| **resolved (verified)** | `repositories.<pkg>` present, `source` is `verified` | Key from `~/.jfrog/agents-conf.json` `defaultGlobalRepos`, checked via `GET /api/repositories/<key>` | **Yes** (at last refresh) |
| **resolved (trusted)** | `repositories.<pkg>` present, `source` is `agents-config` | Key from agents-conf.json with `verifyRepos: false` | **No** |
| **unresolved** | `repositories.<pkg>` is missing | No mapping in agents-conf.json, verify failed, or type not configured | n/a |

The skill relies on `jf setup --repo` to validate that the repo exists at apply
time (`GET /api/repositories/<repoKey>` inside the CLI). Before that, every
value read from this file, the session table, or the workspace binding goes
through `scripts/check-repo-key.sh --repo "$raw"`. A key that fails
`^[A-Za-z0-9._-]+$` (APR `isSafeRepoKey`) is not usable — stop and ask. Do not
paste it into a shell command, including inside single quotes. The shell
parses that line before `jf` starts.

## Reading the cache from the skill

The current `serverId` for this session comes from `jf config export`
(the default server). Read the cache with:

```bash
sid_raw="$(jf c show --format=json | jq -r 'map(select(.isDefault))[0].serverId // empty')"
SID="$(bash <skill_path>/scripts/check-repo-key.sh --server-id "$sid_raw")" || SID=""
CACHE="$HOME/.jfrog/skills-cache/package-resolution.json"

# Get a repo key for a package type (empty if unresolved). Pass "$raw"
# to check-repo-key.sh. Do not copy this output into the command text.
raw="$(jq -r --arg sid "$SID" --arg type "<pkgType>" '.servers[$sid].repositories[$type] // ""' "$CACHE")"

# Dump every resolved (pkgType, repoKey) pair for this SID:
jq -r --arg sid "$SID" '.servers[$sid].repositories | to_entries[] | "\(.key)\t\(.value)"' "$CACHE"

# Inspect resolution source:
jq -r --arg sid "$SID" '.servers[$sid].source' "$CACHE"
```

If `$CACHE` does not exist, or the SID branch is missing, the hook has
not yet resolved on this machine for this server — fall back to reading
the injected "Resolved URLs for this session" table in agent context
(parse the URL to recover `repoKey`, then load it through the quoted heredoc
in SKILL.md Step 3.4 — never into `raw="…"`), and if that is also absent, treat
every package manager as `unresolved` and prompt the user (Step 2).

The resolver refreshes stale entries on session start (TTL + agents-conf.json mtime).
This skill never invalidates the cache — if `jf setup` fails on a repo key, ask the user.

## Not in this file

These belong elsewhere and the skill must not look for them here:

- Tokens, credentials, refresh tokens. (Stored by `jf config`.)
- Per-workspace bindings. (Stored in
  [`.jfrog/local/package-resolution.json`](workspace-binding.md).)
