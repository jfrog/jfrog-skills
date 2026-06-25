# Installing and updating skills

Install and update both download from the registry, so they share the same
`--repo`/`--quiet` rules, blocked-download (403 / Xray) handling, and
verify-landed check.

## Contents

- When evidence verification fails
- Handling a blocked download (403 / Xray-gated)
- Verify the install landed
- Update an installed skill

Install by **slug** (the registry `slug`/`name`, never a display name). Latest
version is used by default, and the user may pass an explicit version.
**The `jf skills install` command takes no project.** Resolving which repo hosts
the slug uses `--list-skill-versions` (below), which does require `--project`, so
resolve it (from `JF_PROJECT`, else ask the user) before that lookup.

```bash
jf skills install "<slug>" \
  --server-id "<SID>" \
  --version "latest" \
  --repo "<repo>" \
  --harness "<harness>" \
  --quiet
```

If the download returns **HTTP 403**, the archive is Xray-gated, not a
permissions or "not found" problem. See *Handling a blocked download
(403 / Xray-gated)* below.

**Always pass `--quiet`.** `jf skills install`/`update` opens an interactive
prompt by default, and an agent's shell has no TTY, so without `--quiet` the
prompt fails (it can abort with `panic: device not configured`). `--quiet` also
defaults to `$CI`, so exporting `CI=true` has the same effect if the flag is ever
unavailable. Run non-interactively and resolve every choice (`--repo`, target)
up front.

**Resolve `<harness>` from the host you are running in. Never take it from your
model name, and never hardcode it.** Get the valid names from the CLI: run
`jf skills list --harness '?'` to print the
`Supported agents:` table, then install into the row for your host. Identify the
host from its environment. For example, `CURSOR_*` → `cursor`,
`CLAUDECODE` → `claude-code`, VS Code / GitHub Copilot → `github-copilot`. If
nothing identifies the host, ask the user. Never assume.

Choose exactly one install target (these are mutually exclusive):

| Flag | Installs into |
|------|---------------|
| `--harness <name>` | The current agent's resolved skills dir (resolve per above, e.g. `cursor`, `claude-code`). |
| `--global` | Each agent's global directory from config. |
| `--project-dir <dir>` | Project root combined with the agent's project path. |
| `--path <dir>` | Direct: files go under `<dir>/<slug>`. |

**Always resolve and pass `--repo`.** When the platform has more than one skills
repository (the common case), `jf skills install` errors with `multiple skills
repositories found … specify --repo` if you omit it, even when the skill lives
in only one repo. So **the first install step is always** to look up where the
slug is hosted with the Agent Guard:

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard \
  --list-skill-versions --project "<PROJECT>" --skill "<slug>" [--server "<SID>"] --format json
# read versions[].version and versions[].locations[].repoKey
```

**Resolve the repo and version only via `--list-skill-versions`.** The catalog
listing (`--list-skills`, even with `--name`) returns just names, not repos or
versions, so use the versions call above to pick the repo, never a name listing.

- **One repo hosts the slug.** Use it as `--repo <repoKey>` directly. Don't ask.
- **Multiple repos host the slug.** Do not pick silently. Naming a project is not
  a repo choice, so ask even when one repo is project-scoped. List the repos (and
  the version each holds), ask the user which to install from, then pass
  `--repo <chosen>`. The newest version may only exist in one of them, so
  surface that to avoid giving the user a stale version.

## When evidence verification fails

If install fails with `evidence verification failed … no evidence found`, the
skill has **no signed evidence/attestation** (proof it's genuine and scanned).
This is a security control. **Do not silently bypass it.** Stop and ask using
**this exact template**:

> `<slug>@<version>` has no signed evidence (proof it is genuine and scanned).
> Installing it skips that security check. Do you want to install it anyway?

Only if the user explicitly agrees, re-run with
`JFROG_SKILLS_DISABLE_QUIET_FAILURE=true`. Never set that flag on your own.

## Handling a blocked download (403 / Xray-gated)

A `jf skills install`/`update` download can return **HTTP 403** even when the
slug, version, and repo are all correct, because the skill archive is gated by Xray
and Artifactory will not serve it until the scan resolves. Do **not** report
this as a permissions or "not found" problem. Query the skill's Xray status to
find out why (the path is the archive `<slug>/<version>/<slug>-<version>.zip`,
URL-encoded):

```bash
jf api --server-id "<SID>" \
  '/artifactory/api/skills/<repo>/xrayStatus?path=<slug>%2F<version>%2F<slug>-<version>.zip'
```

Interpret the `status` field in the response:

- **`SCAN_IN_PROGRESS`.** Xray is still scanning the archive. The download is
  temporarily gated, not blocked. **Do not retry in a tight loop.** Reply using
  **this exact template**:

  > `<slug>@<version>` is still being scanned by Xray and isn't available to
  > download yet. I can retry in a moment if you'd like.

  If it stays `SCAN_IN_PROGRESS` after a couple of polls, switch to **this exact
  template** instead:

  > `<slug>@<version>` is still being scanned by Xray and is taking longer than
  > expected. Try again later, or check with your JFrog administrator if it never
  > clears.
- **Blocked by a policy** (a blocked/violating status, with the offending
  policy in the response body). The skill is **blocked by an Xray policy**.
  Stop. Do not retry. Reply using **this exact template**, filling the
  placeholders:

  > `<slug>@<version>` is **blocked by the Xray policy `<policy-name>`** and
  > cannot be installed. Contact your JFrog administrator to review or resolve
  > the policy.
- **Any other status, or a non-zero `jf api` exit** (`jf api` signals a non-2xx
  response via its exit code plus a stderr `[Warn] … returned NNN` line — see the
  base `jfrog` skill's *CLI and `jf api`* gotchas). Treat as an operational
  failure (auth, endpoint disabled): the deliberate **free-form** case — report
  the CLI error verbatim (no template), but still strip the `Trace ID`.

## Verify the install landed

After install, confirm the `SKILL.md` exists at the resolved install location
before reporting success:

```bash
test -f "<install-dir>/<slug>/SKILL.md" && echo "installed" || echo "MISSING SKILL.md"
```

If the file is missing, report the failure. Do not claim success.

On success, reply using **this exact template**:

> Installed `<slug>@<version>` from `<repo>` into `<harness>`.
> Restart your agent session to load it.

## Update an installed skill

To upgrade an installed skill to a newer version, use the CLI (it re-downloads
and reinstalls in place):

```bash
jf skills update "<slug>" --server-id "<SID>" --harness "<harness>" --version "latest" --quiet
# Preview without touching Artifactory:
jf skills update "<slug>" --server-id "<SID>" --harness "<harness>" --dry-run
# Reinstall even if already at the target version:
jf skills update "<slug>" --server-id "<SID>" --harness "<harness>" --force --quiet
```

Use the same install-target flag (`--harness`/`--global`/`--project-dir`/
`--path`) the skill was installed with. After updating, re-verify the `SKILL.md`
(see *Verify the install landed* above). If the update download 403s, handle it
as in *Handling a blocked download* above.

On success, reply using **this exact template**:

> Updated `<slug>` to `<version>` (`<harness>`).
> Restart your agent session to load it.

If the skill was already current:

> `<slug>` is already at the latest version (`<version>`). Nothing to update.
