---
name: jfrog-setup-package-managers
description: >-
  Use this skill when the user asks to set up, configure, bind, or connect a
  package manager (npm, pip, maven, gradle, go, docker, helm, …) to JFrog
  Artifactory via `jf setup` and `.jfrog/local/package-resolution.json`; when a
  workspace manifest exists with no matching binding entry; or when a session
  hook reports PM config missing. Skip when the binding already has the same
  repo key — the session hook reapplies each start. Never pick a repo by
  discovery; use resolver output only (unless the user explicitly names or
  asks to browse repos). On unresolved or failed setup, ask for a repo key
  with the failure verbatim — never switch servers.
metadata:
  role: workflow
---

# JFrog — Setup Package Managers for Artifactory

Apply the session hook's repo pick via [`jf setup`](references/jf-setup-command.md),
then record it in [`.jfrog/local/package-resolution.json`](references/workspace-binding.md).
`jf setup` writes PM-native config (`.npmrc`, `pip.conf`, …); the binding
lets the hook re-apply on later sessions.

## Scope (this skill vs session hook)

**Session-start hook:** resolves repo keys per package type, injects the
"Resolved URLs for this session" table, refreshes the global cache. The same
renderer is available on demand via `modules/package-resolution/scripts/print-policy.mjs` (the enforce
notice embeds the exact command), so the policy can be loaded after setup.

**This skill:** reads that output, runs `jf setup`, and persists the workspace
binding at `.jfrog/local/package-resolution.json` when PM config is still missing.

**Honor the injected policy's governed scope.** The session policy lists the
package managers it governs. Do **not** *proactively* onboard a PM the policy
doesn't govern (e.g. a stray `Dockerfile` when only `pypi`/`npm` are governed) —
those are intentionally out of scope. An **explicit user request** to set up any
PM still works (Step 1's user-mention signal and Step 2's AskQuestion for an
unlisted PM apply as usual).

## Prerequisites

- `jf setup` **mutates user state** (`~/.npmrc`, `~/.docker/config.json`, …).
  Confirm before the first `jf setup` in a session unless the user explicitly
  requests silent/non-interactive setup.
- Reading [`../jfrog/SKILL.md`](../jfrog/SKILL.md) is required — done as Step 0.1 below.

**Out of scope:** CLI install/login (`../jfrog/references/…`).

## Gotchas

- **Always pass `--repo` and `--server-id`** — omitting `--repo` fails when
  multiple repos match. See [`jf-setup-command.md`](references/jf-setup-command.md).
- **`jf setup` overwrites PM config** without backup — skip PMs whose binding
  already matches (Step 1, signal 2).
- **Docker / Podman — prefix or stop.** `jf setup docker` writes creds only;
  bare `docker pull <img>` hits Docker Hub. Complete setup, then pull via
  `<host>/<repoKey>/<img>`.
- **Binding holds decisions, not credentials** — never write tokens into
  `.jfrog/local/package-resolution.json`.

## References

| File | When to read |
|------|--------------|
| [`references/jf-setup-command.md`](references/jf-setup-command.md) | CLI flags, supported PMs, exit-code contract, `jf setup --help` |
| [`references/global-cache-file.md`](references/global-cache-file.md) | Global cache shape, resolution classes, jq one-liners |
| [`references/workspace-binding.md`](references/workspace-binding.md) | Workspace binding schema, PM → type map, merge semantics |

## Step 0 — Read the base skill, then ensure `jf` is ready

1. **Read [`../jfrog/SKILL.md`](../jfrog/SKILL.md) fully first — always, before any
   `jf` command, even when `jf` is already configured.** It carries the `jf`
   invariants this skill relies on. After reading, run that skill's
   *Environment check* (and export `JFROG_CLI_USER_AGENT`) before the first
   `jf` call.
2. Ensure `jf` + a configured server (`<SID>`). If `jf config show` already
   succeeds, skip to Step 1; otherwise:
   - **`jf --version`** missing → install per
     [`../jfrog/references/jfrog-cli-install-upgrade.md`](../jfrog/references/jfrog-cli-install-upgrade.md).
   - **`jf config show`** empty → login per
     [`../jfrog/references/jfrog-login-flow.md`](../jfrog/references/jfrog-login-flow.md)
     or `jf config add` with access-token (Bearer-only).
3. Do not run `jf setup` until both succeed. Confirm before install/login.

## Step 1 — Identify package managers to bind

Combine four signals, in order; intersect with `jf setup --help` supported list:

1. **Explicit user mention.** Map aliases: python → `pip`/`poetry`; java →
   `maven`/`gradle`; node → `npm`/`yarn`/`pnpm` by lockfile.
2. **Workspace binding** — read `.jfrog/local/package-resolution.json`. Drop PMs
   already bound to the same key unless recovering from 401/403 (re-run same
   key). PM → type table: [`workspace-binding.md`](references/workspace-binding.md).
3. **Workspace manifests** when still ambiguous:

   | Manifest file | Package manager |
   |---|---|
   | `package.json`, `pnpm-lock.yaml`, `yarn.lock` | `npm` (+ `yarn`/`pnpm` if lockfiles present) |
   | `requirements.txt`, `Pipfile` | `pip` (`pipenv` for `Pipfile`) |
   | `pyproject.toml` | `poetry` if `[tool.poetry]`; else `pip` |
   | `pom.xml` | `maven` |
   | `build.gradle`, `build.gradle.kts` | `gradle` |
   | `go.mod` | `go` |
   | `Dockerfile`, `compose.yaml`, `docker-compose.yml` | `docker` / `podman` |
   | `*.csproj`, `NuGet.Config` | `nuget` / `dotnet` |
   | `Chart.yaml` | `helm` |

4. **`jf setup --help`** — filter candidates; never hardcode the PM list. See
   [`jf-setup-command.md`](references/jf-setup-command.md). Unsupported PM →
   report gap, skip.

## Step 2 — Get the resolved repo

For each `<pm>`, recover `<repoKey>` and `<serverId>` from the first source
available:

1. **"Resolved URLs for this session"** table (default). Parse `<repoKey>`
   from URL; `<serverId>` from host.
2. **Workspace binding** — if table was trimmed. `repositories.<type>`.
3. **Global cache** — last resort only; never overrides (1) or (2). See
   [`global-cache-file.md`](references/global-cache-file.md).

Cache disagreeing with (1)/(2) is not a reason to change the repo.

**Don't choose a repo yourself:** no listing, enumerating, probing, or iterating
`--server-id` to pick one, and don't second-guess the resolver — use resolver
output only. If the user explicitly asks to browse repos, list them via
`jf api "/artifactory/api/repositories?type=virtual&packageType=<pm>"` (filter by
repo type — prefer `virtual` — and package type), then let the user choose; the
agent still never makes the choice on its own.

### Unresolved repo key

Ask via AskQuestion:

> No default repo for `<pm>` on `<SID>`.
> Which Artifactory repository should I use? (repo key, or `abort`.)

Cap at **2 answers per PM**, then abort. User may override repo only, never server.

## Step 3 — Confirm, run `jf setup`, persist binding

1. Present the plan, one row per PM:

   ```text
   <pm>  → <repoKey> on <SID>               (source: resolver)
   <pm>  → <repoKey> on <SID>               (source: user-supplied)
   ```

2. Show binding diffs when the repo key changes.

3. **Confirm** via AskQuestion (`apply` / `change repos` / `abort`) unless the
   user explicitly requested silent/non-interactive setup — then run directly.

4. Sequentially, one PM at a time:

   ```bash
   jf setup <pm> --server-id <SID> --repo <repoKey> [--project <key>]
   ```

5. **Exit code `0` = success** — merge binding (step 6). On non-zero, **stop**,
   surface CLI output verbatim, offer alternate repo or `abort` (2-answer cap).

6. On success, merge into `.jfrog/local/package-resolution.json` per
   [`workspace-binding.md`](references/workspace-binding.md):

   ```json
   { "repositories": { "<pkgType>": "<repoKey>" } }
   ```

   Map PM → type via the reference table. Merge atomically.

## Step 4 — Load the routing policy

If this session started with the "routing NOT READY" (enforce) notice, that
notice includes a refresh command (`node <plugin>/modules/package-resolution/scripts/print-policy.mjs`).
After Step 3 succeeds, run that exact command and treat its stdout as the
authoritative, now-current policy — it prints the resolved Artifactory URLs and
hard rules. Continue the original request using those URLs.

If the command prints nothing, routing is off by config
(`packageResolution.enabled` is not `true`) — an admin opt-in. Report that to
the user and let them decide whether to enable it.
