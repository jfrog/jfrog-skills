# `jf setup` Command Reference

Configures a local PM to resolve from / publish to Artifactory. CLI install
and server config: [`../../jfrog/SKILL.md`](../../jfrog/SKILL.md).

## Invocation

```bash
jf setup <pm> --server-id <SID> --repo <repo-key> [--project <project-key>]
```

Always pass `--server-id` and `--repo`. Without `--repo`, multiple matching
repos trigger an interactive prompt or error (`Please provide the repository
name using '--repo' flag`).

`docker` / `podman` use the same shape — CLI validates the repo via
`GET /artifactory/api/repositories/<key>` before configuring. Record
`repositories.docker` in the workspace marker for pull URL composition.

## Supported PM list

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

Do not continue to the next PM after a failure.

## Agent notes

- `pyproject.toml` with `[tool.poetry]` → `poetry`; plain PEP 621 → `pip`.
- `jf setup --help` is the authoritative flag reference.
