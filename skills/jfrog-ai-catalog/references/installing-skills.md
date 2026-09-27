# Installing and updating skills

Install and update both download from the registry, so they share the same
`--repo`/`--quiet` rules, blocked-download (403 / Xray) handling, and
verify-landed check.

## Contents

- Choice UI
- When evidence verification fails
- Handling a blocked download (403 / Xray-gated)
- Verify the install landed
- Update an installed skill

Install by **slug** (the registry `slug`/`name`, never a display name). Always
resolve and pass a concrete version and repository. Never install with
`--version "latest"` and never choose the first repository as a default —
at install time the repo is not yet resolved, and `--version "latest"` could
silently pick an ambiguous version/repo combination without the required ask.

**Exception — `jf skills update` may use `--version "latest"`.** An update
target is already installed, so its repo is fixed — not automatically by
`jf`, but by reading it back from that install's own record (see *Update an
installed skill* below) — and `allowStatus` is a per-repo fact, not
per-version, so every version in that already-allowed repo is equally
allowed. "Latest version in this specific, already-resolved repo" carries
none of the version/repo ambiguity this rule exists to prevent.

**The `jf skills install` command takes no project.** Resolving which repo hosts
the slug uses `--list-skill-versions` (below), which does require `--project`, so
use `<PROJECT>` resolved at session start (see SKILL.md Prerequisites).

```bash
jf skills install "<slug>" \
  --server-id "<SID>" \
  --version "<version>" \
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

**Resolve `<harness>` from the environment check script — never from your model
name.** If `<UA>` is not already known from this session, run
`bash <skill_path>/../jfrog/scripts/check-environment.sh <model-slug>` now and capture
its stdout as `<UA>`. Parse the `tool=<h>` field from `<UA>` and map it to a
`jf` harness name:

| `tool=` value in `<UA>` | `--harness` for `jf skills` |
|-------------------------|------------------------------|
| `claude` | `claude-code` |
| `cursor` | `cursor` |
| `copilot` | `github-copilot` |
| `unknown`, empty, or any other | Ask the user |

If `tool` is `unknown`, empty, or not in the table — do **not** guess. Ask
the user for the desired install path and use `--path <dir>` instead.
**Exception — Kiro and Junie (install only):** `jf` accepts neither
`--harness kiro` nor `--harness junie`, so if you're self-identified as either
(Kiro IDE / `kiro-cli`, or Junie — `check-environment.sh` detects Junie but not
Kiro), skip asking and use `--path` directly: `.kiro/skills` (project) /
`~/.kiro/skills` (global, or `$KIRO_HOME/skills` if `KIRO_HOME` is set) for
Kiro; `.junie/skills` (project) / `~/.junie/skills` (global) for Junie. This
exception does not extend to `jf skills list` — see *List currently installed
skills* in `managing-installed-skills.md`.

Choose exactly one install target (these are mutually exclusive):

| Flag | Installs into |
|------|---------------|
| `--harness <name>` | The current agent's resolved skills dir (resolve per above, e.g. `cursor`, `claude-code`). |
| `--global` | Each agent's global directory from config. |
| `--project-dir <dir>` | Project root combined with the agent's project path. |
| `--path <dir>` | Direct: files go under `<dir>/<slug>`. |

**Always resolve and pass a concrete `--version` and `--repo`.** When the platform
has more than one skills repository (the common case), `jf skills install`
errors with `multiple skills repositories found … specify --repo` if you omit
it, even when the skill lives in only one repo. Resolve both values from this
one Agent Guard query:

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard \
  --list-skill-versions --project "<PROJECT>" --skill "<slug>" --allowed-only [--server "<SID>"] [--cursor <C>] --format json
# read versions[].version, versions[].locations[].repoKey, versions[].locations[].allowStatus, exhausted, cursor
```

**This can be paginated — read every page before resolving anything from it.**
If `exhausted` is `false`, keep calling with `--cursor <cursor>` (same
`--skill`/`--allowed-only`) and merge every page's `versions[]` before doing
the version/repo resolution below. A skill with more versions than one page
holds must never look like it has fewer, or be missing the repo that only
hosts its true latest version. Do this silently, with no pagination commentary
to the user. Once merged and `exhausted` is `true`, that combined result is
what "Do not make another catalog call" below refers to — you still must not
re-run this query a second time to separately resolve version and then repo.

**Resolve the repo and version only via `--list-skill-versions`.** The catalog
listing (`--list-skills`, even with `--name`) returns just names, not repos or
versions, so use the versions call above to pick the repo, never a name listing.

Resolve choices in this order. **These are two separate questions, asked one
at a time — never combine them into a single choice.** Even when the
version-versions endpoint returns every version×repo combination in one
response, do not present that as a flattened list (e.g. "0.1.1 →
repo-a", "0.1.1 → repo-b", "0.1.0 → repo-a", "0.1.0 → repo-b") and ask the
user to pick one row. Ask which version first, stop and wait for that
answer, and only then — scoped to the chosen version alone — ask which repo,
if more than one hosts it.

1. **Version first.**
   - If the user named a version, verify that exact value exists in
     `versions[].version`. If absent, stop and offer the returned versions with
     the picker described below. Do not make another catalog call.
   - If the user did not name a version and exactly one version exists, use that
     concrete version without asking.
   - If the user did not name a version and more than one exists, ask which
     version to install. Present versions newest first. Never assume the newest,
     `"latest"`, or the first response entry. **Stop your turn on this
     question and wait for the user's reply.** Do not pick one yourself and
     continue in the same response — see *Choice UI* below.
   - **"Newest allowed" is still assuming the newest.** `--allowed-only`
     filters out versions/locations you must never show, not a signal that
     the remaining newest one is the right default. If more than one
     governance-allowed version remains, the ask above still applies — do
     not silently install "the newest allowed version" and only ask about
     the repo.
   - If no versions exist, report that the skill is unavailable for the project
     and stop.

2. **Repository second.** After settling the version, use only that version
   object's `locations[]`; discard locations attached to every other version.
   Do not make another catalog call.
   - If the user named a repo, verify it is among the selected version's
     locations. If absent, say that repo is not governance-allowed for the
     project and stop. Never retry without the policy filter or inspect the repo
     directly.
   - If exactly one repo hosts the selected version, use its `repoKey` without
     asking.
   - If more than one repo hosts the selected version, ask which repo to use.
     Never pick the first or the most recently updated-looking repo: equal
     slug+version values in different repos can contain different skills.
     **Stop your turn on this question and wait for the user's reply.** Do not
     pick one yourself and continue in the same response — see *Choice UI*
     below.
   - **There is no "project-owned repo."** `<PROJECT>` scopes which skills and
     versions the catalog query returns — it is not a field on `locations[]`
     and it never disambiguates between multiple repos that host the same
     version. Do not infer a repo from the project name, a repo name that
     happens to contain the project name, "the one that matches the active
     project," or any other derived signal not present in `locations[]`
     (`repoKey`, `allowStatus`). If you catch yourself constructing a
     justification for skipping the ask, that justification is wrong — ask
     instead.
   - If the selected version has no returned locations, report it unavailable
     for the project and stop.

   **Each repo carries its own governance status (MLAI-1309).** Skill
   identity is name+version+repository-path, not just name+version, and a
   repo's `allowStatus` in `locations[]` is a per-repo fact, never a
   per-version one. The skill always passes `--allowed-only` to
   `--list-skill-versions`, so only governance-allowed repos ever come back
   and every candidate you show the user is installable. Never re-run
   without the flag to surface blocked repos — if a repo the user expects is
   missing, say it isn't governance-allowed for this project and stop there.

## Choice UI

Use the agent surface's native interactive single-choice picker (an arrow-key
selectable menu) whenever a version or repo choice is required and such a
picker is available to the skill. Do not print a table and wait for a typed
reply when a picker is available.

**Asking is not complete until the user replies — on any surface.** Whether
you use a native picker or the Markdown table fallback, end your turn on the
question itself. Never treat rendering the question as satisfying the "ask
the user" requirement and then proceed to resolve the choice yourself and
call `jf skills install` in that same turn — that is exactly the missing
version/repo confirmation this section exists to prevent (MLAI-1309). This
applies even on chat-only surfaces with no way to block for input: the fix
for having no blocking mechanism is to stop responding, not to guess and
install.

**Not every harness has a native picker.** Some agent surfaces (for example
GitHub Copilot Chat in the VS Code plugin) run skills as chat-turn
instructions with no programmatic access to a native single-choice picker.
Never claim or imply a picker exists where it doesn't — on those surfaces,
always use the Markdown table fallback below.

- Version picker: label each option with only the version string, newest first.
  Do not include repo keys before the version is settled.
- Repo picker: label each option with only its `repoKey`. Put
  `<slug>@<version>` in that option's description or subtitle, not its label.
- Do not append "(allowed)" to repo labels. Every returned location is already
  allowed.
- Fall back to a Markdown table followed by a plain-language question whenever
  no interactive picker exists in the current context. Use one **Version**
  column (newest first) for versions or one **Repository** column (`repoKey`
  only) for repos, and name `<slug>@<version>` in the repo question. Never add
  an "(allowed)" annotation.

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
and reinstalls in place). **`jf skills update` does not remember which repo the
skill was installed from — you must resolve and pass `--repo` yourself.**
Without it, update either fails with `multiple skills repositories found`
(listing every skills repo on the whole server, not scoped to this project or
its governance policy at all) or, if handed some other repo, silently updates
from it — even one that never hosted the originally installed skill. Never
run `jf skills update` without a resolved `--repo`.

**Resolve `<repo>` from the existing install, never by asking the user or
guessing.** Every install writes it to `.jfrog/skill-info.json` under the
install directory:

```bash
jq -r '.repo' "<install-dir>/<slug>/.jfrog/skill-info.json"
```

If that file or its `.repo` field is missing (for example, a skill that was
manually copied in rather than installed with `jf skills install`), tell the
user you can't safely determine which repo to update from and stop. Do not
substitute a repo from a fresh catalog listing instead — a same-named repo
returned there is not proof it is the repo this specific install came from.

```bash
jf skills update "<slug>" --server-id "<SID>" --harness "<harness>" --repo "<repo>" --version "latest" --quiet
# Preview without touching Artifactory:
jf skills update "<slug>" --server-id "<SID>" --harness "<harness>" --repo "<repo>" --dry-run
# Reinstall even if already at the target version:
jf skills update "<slug>" --server-id "<SID>" --harness "<harness>" --repo "<repo>" --force --quiet
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
