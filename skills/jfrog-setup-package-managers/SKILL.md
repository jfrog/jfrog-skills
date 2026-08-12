---
name: jfrog-setup-package-managers
description: >-
  Use this skill when the user asks to set up, configure, bind, or connect a
  package manager (npm, pip, uv, pipenv, maven, gradle, go, docker, helm, ...)
  to JFrog Artifactory via `jf setup` and `.jfrog/local/package-resolution.json`;
  when a workspace manifest exists with no matching binding entry; or when a
  session hook reports package-manager config missing. Skip when the binding
  already has the same repo key. Never pick a repo by discovery; use resolver
  output only (unless the user names or asks to browse repos). On unresolved
  or failed setup, ask with the failure verbatim — never switch servers.
  NOT for installing packages, general Artifactory repo operations (use the base
  jfrog skill), or MCP server setup (use jfrog-mcp-management).
metadata:
  role: workflow
---

# JFrog — Setup Package Managers for Artifactory

Apply the session hook's repo pick via [`jf setup`](references/jf-setup-command.md),
then record it in [`.jfrog/local/package-resolution.json`](references/workspace-binding.md).
`jf setup` writes package-manager-native config (`.npmrc`, `pip.conf`, `uv.toml`, …); the binding
lets the hook re-apply on later sessions.

## At a glance (always-read core)

Every `jf setup` this session:

- **Cover base [`../jfrog/SKILL.md`](../jfrog/SKILL.md) At-a-glance / Tier A**
  (Step 0.1) → `<UA>`, `--server-id` placement, single-server, stop-don't-switch.
  Prefer full base SKILL.md when you can; Tier B (`cli-gotchas` / `jf-api` / …)
  only if the next action needs `jf api` / advanced CLI
- **Always `--repo` + `--server-id`.** `<repoKey>` ← [Step 2](#step-2--get-the-resolved-repo)
  (table / binding / global-cache) or user override / unresolved AskQuestion;
  never self-discover. `<SID>` ← resolver only (never user-selected)
- **Confirm** before first `jf setup` unless user asked silent / non-interactive
- **Exit 0 → merge binding**; non-zero → stop, surface CLI verbatim, offer
  alternate repo or `abort` (2-answer cap)
- **Binding = decisions, not creds** — never write tokens into
  `.jfrog/local/package-resolution.json`
- **Unresolved / failed:** ask with failure verbatim — never switch servers
- **Never skip** [Gotchas](#gotchas--hard-rules-never-skip) + base Tier A hard
  rules (`../jfrog/SKILL.md` Cautious execution / Server selection / Tier A
  gotcha floor). Full `cli-gotchas.md` is Tier B — not required for `jf setup`

Steps: [0](#step-0--read-the-base-skill-then-ensure-jf-is-ready) →
[1](#step-1--identify-package-managers-to-bind) →
[2](#step-2--get-the-resolved-repo) →
[3](#step-3--confirm-run-jf-setup-persist-binding) →
[4](#step-4--load-the-routing-policy)

## Scope (this skill vs session hook)

**Session-start hook:** resolves repo keys per package type, injects the
"Resolved URLs for this session" table, refreshes the global cache. The same
renderer is available on demand via `modules/package-resolution/scripts/print-policy.mjs` (the enforce
notice embeds the exact command), so the policy can be loaded after setup.

**This skill:** reads that output, runs `jf setup`, and persists the workspace
binding at `.jfrog/local/package-resolution.json` when package-manager config is still missing.

**Honor the injected policy's governed scope.** The session policy lists the
package managers it governs. Do **not** *proactively* onboard a package manager the policy
doesn't govern (e.g. a stray `Dockerfile` when only `pypi`/`npm` are governed) —
those are intentionally out of scope. An **explicit user request** to set up any
package manager still works (Step 1's user-mention signal and Step 2's AskQuestion for an
unlisted package manager apply as usual).

## Prerequisites

- `jf setup` **mutates user state** (`~/.npmrc`, `~/.docker/config.json`, …).
  Confirm before the first `jf setup` in a session unless the user explicitly
  requests silent/non-interactive setup.
- Covering base At-a-glance / Tier A is required — done as Step 0.1 below.

**Out of scope:** CLI install/login (`../jfrog/references/…`).

## Gotchas — hard rules (never skip)

**Not tips.** Do/don'ts and known traps for `jf setup` — follow every bullet
before binding. Also honor base **Tier A** hard rules from
[`../jfrog/SKILL.md`](../jfrog/SKILL.md) (Cautious execution, Server selection,
Tier A gotcha floor). Full `cli-gotchas.md` is Tier B — load only if this
session also needs `jf api` / advanced CLI.

- **Always pass `--repo` and `--server-id`** — omitting `--repo` fails when
  multiple repos match. See [`jf-setup-command.md`](references/jf-setup-command.md).
- **`jf setup` overwrites package-manager config** without backup — skip package managers whose binding
  already matches (Step 1, signal 2).
- **Docker / Podman — prefix or stop.** `jf setup docker` writes creds only;
  bare `docker pull <img>` hits Docker Hub. Complete setup, then pull via
  `<host>/<repoKey>/<img>`.
- **Binding holds decisions, not credentials** — never write tokens into
  `.jfrog/local/package-resolution.json`.
- **`gradle` ≠ `maven`.** Bind under `repositories.gradle`, never `repositories.maven`.
- **Yarn / Poetry** — not APR zero-touch; bind only on explicit user ask (Step 1).

## References

| File | When to read |
|------|--------------|
| [`references/jf-setup-command.md`](references/jf-setup-command.md) | CLI flags, supported package managers, exit-code contract, `jf setup --help` |
| [`references/global-cache-file.md`](references/global-cache-file.md) | Global cache shape, resolution classes, jq one-liners |
| [`references/workspace-binding.md`](references/workspace-binding.md) | Workspace binding schema, package-manager → type map, merge semantics |

## Step 0 — Read the base skill, then ensure `jf` is ready

1. **Cover base skill At-a-glance / Tier A before the first non-exempt `jf`
   (even when `jf` is already configured).** Prefer reading
   [`../jfrog/SKILL.md`](../jfrog/SKILL.md) in full when you can; the At-a-glance
   Tier A floor is enough for `jf setup` / package-manager binding. Load Tier B
   (`cli-gotchas.md`, `jf-api.md`, …) only if the next action needs `jf api` /
   advanced CLI. Then run that skill's *Environment check* (and export
   `JFROG_CLI_USER_AGENT`) before the first `jf` call.
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

1. **Explicit user mention.** Map aliases: python → `pip`/`uv`/`pipenv` (and
   `poetry` only if the user named Poetry); java → `maven`/`gradle`; node →
   `npm`/`pnpm` by lockfile (`yarn` only if the user named Yarn).
2. **Workspace binding** — read `.jfrog/local/package-resolution.json`. Drop
   package managers already bound to the same key unless recovering from 401/403
   (re-run same key). Package-manager → type table:
   [`workspace-binding.md`](references/workspace-binding.md).
3. **Workspace manifests** when still ambiguous (several package managers of one
   type may apply — e.g. `requirements.txt` **and** `uv.lock`):

   | Manifest / signal | Package manager |
   |---|---|
   | `package.json`, `pnpm-lock.yaml` | `npm` (+ `pnpm` if `pnpm-lock.yaml` present) |
   | `yarn.lock` (alone) | `npm` — do **not** auto-select `yarn` |
   | `requirements.txt` | `pip` |
   | `Pipfile` | `pipenv` |
   | `uv.lock` | `uv` — suppresses bare `pyproject.toml` → `pip`; keep `requirements.txt` + `uv.lock` as multi-PM |
   | `pyproject.toml` | `[tool.uv]` → `uv`; `[tool.poetry]` → `poetry` only on explicit user ask, else **not applicable** (do not select `pip`); bare PEP 621 with **no** `uv.lock` → `pip` |
   | `pom.xml` | `maven` |
   | `build.gradle`, `build.gradle.kts` | `gradle` (bind under type **`gradle`**) |
   | `go.mod` | `go` |
   | `Dockerfile`, `compose.yaml`, `docker-compose.yml` | `docker` / `podman` |
   | `*.csproj`, `NuGet.Config` | `nuget` / `dotnet` |
   | `Chart.yaml` | `helm` |

   **Binary gate (client tools only):** missing client on `PATH` → skip as not
   applicable; do **not** substitute another package manager or report setup
   success. **Exempt `maven` / `gradle`** (config-only). Details:
   [`jf-setup-command.md`](references/jf-setup-command.md).

4. **`jf setup --help`** — filter candidates; never hardcode the list. See
   [`jf-setup-command.md`](references/jf-setup-command.md). Unsupported → report
   gap, skip.

## Step 2 — Get the resolved repo

For each `<package-manager>`, recover `<repoKey>` and `<serverId>` from the first source
available:

1. **"Resolved URLs for this session"** table (default). Parse `<repoKey>`
   from URL; `<serverId>` from host.
2. **Workspace binding** — if table was trimmed. `repositories.<type>`
   (`gradle` → `repositories.gradle`, not `maven`).
3. **Global cache** — last resort only; never overrides (1) or (2). See
   [`global-cache-file.md`](references/global-cache-file.md).

Cache disagreeing with (1)/(2) is not a reason to change the repo.

**Don't choose a repo yourself:** no listing, enumerating, probing, or iterating
`--server-id` to pick one, and don't second-guess the resolver — use resolver
output only. If the user explicitly asks to browse repos, list them via
`jf api "/artifactory/api/repositories?type=virtual&packageType=<pkgType>"`
(Artifactory **package type** from the binding map — `gradle` not `maven`;
`uv` / `pip` / `pipenv` / `poetry` → `pypi`), then let the user choose; the
agent still never makes the choice on its own.

### Unresolved repo key

Ask via AskQuestion (include the resolver/setup failure text verbatim):

> No default repo for `<package-manager>` on `<SID>`.
> Failure: `<verbatim failure>`
> Which Artifactory repository should I use? (repo key, or `abort`.)

Cap at **2 answers per package manager**, then abort. User may override repo only, never server.

## Step 3 — Confirm, run `jf setup`, persist binding

1. Present the plan, one row per package manager:

   ```text
   <package-manager>  → <repoKey> on <SID>               (source: resolver)
   <package-manager>  → <repoKey> on <SID>               (source: user-supplied)
   ```

2. Show binding diffs when the repo key changes.

3. **Confirm** via AskQuestion (`apply` / `change repos` / `abort`) unless the
   user explicitly requested silent/non-interactive setup — then run directly.

4. Sequentially, one package manager at a time:

   ```bash
   jf setup <package-manager> --server-id <SID> --repo <repoKey> [--project <key>]
   ```

5. **Exit code `0` = success** — merge binding (step 6). On non-zero, **stop**,
   surface CLI output verbatim, offer alternate repo or `abort` (2-answer cap).

6. On success, merge into `.jfrog/local/package-resolution.json` per
   [`workspace-binding.md`](references/workspace-binding.md):

   ```json
   { "repositories": { "<pkgType>": "<repoKey>" } }
   ```

   Map package manager → type via the reference table (`gradle` → `gradle`).
   Merge atomically.

## Step 4 — Load the routing policy

If this session started with the "routing NOT READY" (enforce) notice, that
notice includes a refresh command (`node <plugin>/modules/package-resolution/scripts/print-policy.mjs`).
After Step 3 succeeds, run that exact command and treat its stdout as the
authoritative, now-current policy — it prints the resolved Artifactory URLs and
hard rules. Continue the original request using those URLs.

If the command prints nothing, routing is off by config
(`packageResolution.enabled` is not `true`) — an admin opt-in. Report that to
the user and let them decide whether to enable it.

## Before you run `jf setup` — checklist

[At a glance](#at-a-glance-always-read-core) invariants:

- [ ] base At-a-glance / Tier A covered; `<UA>` exported
- [ ] `<repoKey>` ← Step 2 or user override; `<SID>` ← resolver only
- [ ] confirmed (or explicit silent-setup)
- [ ] `jf setup <pm> --server-id <SID> --repo <repoKey>`
- [ ] exit 0 → merge binding (no creds); non-zero → stop + report verbatim;
      never switch servers
- [ ] **never skip** Gotchas (this skill) + base Tier A hard rules (full
      `cli-gotchas.md` only if Tier B path)
