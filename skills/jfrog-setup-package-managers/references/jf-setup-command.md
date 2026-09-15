# `jf setup` Command Reference

Configures a local package manager to resolve from / publish to Artifactory. CLI
install and server config: [`../../jfrog/SKILL.md`](../../jfrog/SKILL.md).

## Invocation

```bash
jf setup <package-manager> --server-id <SID> --repo <repo-key> [--project <project-key>]
```

Always pass `--server-id` and `--repo`. Without `--repo`, multiple matching
repos trigger an interactive prompt or error (`Please provide the repository
name using '--repo' flag`).

`docker` / `podman` use the same shape — CLI validates the repo via
`GET /artifactory/api/repositories/<key>` before configuring. Record
`repositories.docker` in the workspace marker for pull URL composition.

## Supported package-manager list

Drifts across CLI versions — always parse from the installed binary:

```bash
jf setup --help
```

Look for the "Supported package managers are:" line. Never hardcode.

## Success and failure

| Signal | Meaning | Action |
|---|---|---|
| Exit `0` | Success | Merge marker, continue |
| Non-zero | Failure | Stop; surface stdout+stderr verbatim |
| `repository <key> not found` | Bad key, wrong type, or permissions | AskQuestion for alternate repo |
| `401` / `403` | Token issue | Re-login same server — [`jfrog-login-flow.md`](../../jfrog/references/jfrog-login-flow.md) |
| Wrong server `404` | Bad `<SID>` | Stop — never iterate servers |

Do not continue to the next package manager after a failure.

## Agent notes

### Python / Node detection (composition)

- `uv.lock` → `uv` (writes `uv.toml`, not `pip.conf`). Takes precedence over a
  bare `pyproject.toml` pip fallback — common layout is `uv.lock` + PEP 621
  **without** `[tool.uv]`; select `uv` only, never also `pip`.
- `requirements.txt` + `uv.lock` → bind **both** `pip` and `uv` (independent
  manifests). Missing `uv` binary → skip `uv` as not applicable; do **not**
  substitute `pip` for the uv candidate (pip still binds from its own file).
- `pyproject.toml`:
  1. `[tool.uv]` → `uv`
  2. `[tool.poetry]` → `poetry` **only** on explicit user ask; otherwise **not
     applicable** (do not fall through to `pip`)
  3. Bare PEP 621 with **neither** uv signal and **no** `uv.lock` → `pip`
- Prefer `npm` / `pnpm` for Node; `yarn.lock` alone → `npm`. Do not proactively
  run `jf setup yarn` / `jf setup poetry` (APR zero-touch omits both).

### Binary gate / types

- Missing package-manager binary → skip that candidate; do not substitute another.
  Exception: `maven` / `gradle` need no client binary (`jf setup` writes config
  only; wrappers/`pom.xml`/Gradle files are enough). Bind `gradle` under the
  **`gradle`** package type (not `maven`).
- Browse repos with Artifactory `packageType` from the binding map (`uv` →
  `pypi`, not `uv`).
- `jf setup --help` is the authoritative flag reference.
