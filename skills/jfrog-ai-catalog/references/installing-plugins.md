# Installing and updating plugins

Install and update both download from the registry, so they share the same
`--repo`/`--quiet` rules and verify-landed check.

## Contents

- When evidence verification fails
- Verify the install landed
- Update an installed plugin

Install by **slug** (the registry `slug`/`name`, never a display name). Latest
version is used by default, and the user may pass an explicit version.
**The `jf agent plugins install` command takes no project.** Resolving which repo hosts
the slug uses `--list-agent-plugin-versions` (below), which does require `--project`, so
use `<PROJECT>` resolved at session start (see SKILL.md Prerequisites).

```bash
jf agent plugins install "<slug>" \
  --server-id "<SID>" \
  --version "latest" \
  --repo "<repo>" \
  --harness "<harness>" \
  --quiet
```

**Always pass `--quiet`.** `jf agent plugins install`/`update` opens an interactive
prompt by default, and an agent's shell has no TTY, so without `--quiet` the
prompt fails. `--quiet` also defaults to `$CI`, so exporting `CI=true` has the
same effect if the flag is ever unavailable. Run non-interactively and resolve
every choice (`--repo`, target) up front.

**Resolve `<harness>` from the environment check script — never from your model
name.** If `<UA>` is not already known from this session, run
`bash <skill_path>/../jfrog/scripts/check-environment.sh <model-slug>` now and capture
its stdout as `<UA>`. Parse the `tool=<h>` field from `<UA>` and pass it straight
through as `--harness <h>`.

If `tool` is `unknown` or empty, do **not** guess — ask the user for the
desired install path and use `--path <dir>` instead.

If the CLI rejects the harness with `unknown agent`, fall back to asking the
user for `--path <dir>`, the same as the unknown/empty case above.

Choose exactly one install target (these are mutually exclusive):

| Flag | Installs into |
|------|---------------|
| `--harness <name>` | The current agent's resolved plugins dir (resolve per above, e.g. `cursor`, `claude`). |
| `--global` | Each agent's global directory from config. |
| `--project-dir <dir>` | Project root combined with the agent's project path. |
| `--path <dir>` | Direct: files go under `<dir>/<slug>`. |

**Always resolve and pass `--repo`.** When the platform has more than one plugins
repository (the common case), `jf agent plugins install` errors with
`multiple plugins repositories found … specify --repo` if you omit it, even when
the plugin lives in only one repo. So **the first install step is always** to look
up where the slug is hosted with the Agent Guard:

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard \
  --list-agent-plugin-versions --project "<PROJECT>" --agent-plugin "<slug>" [--server "<SID>"] --format json
# read versions[].version and versions[].locations[].repoKey
```

**Resolve the repo and version only via `--list-agent-plugin-versions`.** The catalog
listing (`--list-agent-plugins`, even with `--name`) returns just names, not repos or
versions, so use the versions call above to pick the repo, never a name listing.

- **One repo hosts the slug.** Use it as `--repo <repoKey>` directly. Don't ask.
- **Multiple repos host the slug.** Do not pick silently. List the repos (and
  the version each holds), ask the user which to install from, then pass
  `--repo <chosen>`. The newest version may only exist in one of them, so
  surface that to avoid giving the user a stale version.

## When evidence verification fails

If install fails with `evidence verification failed … no evidence found`, the
plugin has **no signed evidence/attestation** (proof it's genuine and scanned).
This is a security control. **Do not silently bypass it.** Stop and ask using
**this exact template**:

> `<slug>@<version>` has no signed evidence (proof it is genuine and scanned).
> Installing it skips that security check. Do you want to install it anyway?

Only if the user explicitly agrees, re-run with
`JFROG_AGENT_PLUGINS_DISABLE_QUIET_FAILURE=true`. Never set that flag on your own.

## Verify the install landed

After install, confirm the slug shows up as installed — don't guess where
`plugin.json` lives inside the bundle (layout isn't guaranteed, see
*Validate the bundle* in `publishing-plugins.md`). `jf agent plugins list` is
the source of truth for what's actually installed:

```bash
jf agent plugins list --server-id "<SID>" --harness "<harness>" --format json \
  | jq -e --arg slug "<slug>" '.[] | select(.name == $slug)' >/dev/null \
  && echo "installed" || echo "MISSING from installed list"
```

If the slug is missing, report the failure. Do not claim success.

On success, reply using **this exact template**:

> Installed `<slug>@<version>` from `<repo>` into `<harness>`.
> Restart your agent session to load it.

## Update an installed plugin

To upgrade an installed plugin to a newer version, use the CLI (it re-downloads
and reinstalls in place):

```bash
jf agent plugins update --slug "<slug>" --server-id "<SID>" --harness "<harness>" --version "latest" --quiet
# Preview without touching Artifactory:
jf agent plugins update --slug "<slug>" --server-id "<SID>" --harness "<harness>" --dry-run
# Reinstall even if already at the target version:
jf agent plugins update --slug "<slug>" --server-id "<SID>" --harness "<harness>" --force --quiet
# Update all installed plugins at once:
jf agent plugins update --all --server-id "<SID>" --harness "<harness>" --quiet
```

Note: unlike `jf skills update`, the slug is passed as `--slug <slug>` (a named
flag), not as a positional argument. Use the same install-target flag
(`--harness`/`--global`/`--project-dir`/`--path`) the plugin was installed with.
After updating, re-verify the `plugin.json` (see *Verify the install landed* above).

On success, reply using **this exact template**:

> Updated `<slug>` to `<version>` (`<harness>`).
> Restart your agent session to load it.

If the plugin was already current:

> `<slug>` is already at the latest version (`<version>`). Nothing to update.
