# Discovering skills

List-all and versions go through the **Agent Guard** and are always limited to
skills allowed by the project's governance policy. This has no exceptions for
those Agent Guard catalog calls (`--list-skills`, `--list-skill-versions`).

The repo-scoped `jf skills list --repo` command below is a different, narrower
tool: it lists a repository's raw contents directly from Artifactory, not
through Agent Guard, so it is not governance-filtered. It is not a discovery
path — see *List a repo's skills* for when it's appropriate to use.

## List skills (page through the catalog)

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard \
  --list-skills --project "<PROJECT>" --allowed-only [--name <PATTERN>] [--server "<SID>"] [--page-size <N>] [--cursor <C>] --format json
```

| Flag | Required | Purpose |
|------|----------|---------|
| `--project <PROJECT>` | **Yes** | AI Catalog project to list. |
| `--allowed-only` | **Yes** | Limit results to skills allowed by project policy. Never omit it. |
| `--name <PATTERN>` | No | Find skills by name: server-side, case-insensitive substring, scoped to the project. |
| `--server <SID>` | No | jf CLI config entry to authenticate with (defaults to the resolved single server). |
| `--page-size <N>` | No | Results per page. Pass `50` to stay bounded. The Agent Guard defaults to 500 if omitted. |
| `--cursor <C>` | No | Continuation cursor from a previous page's JSON, to fetch the next page. |
| `--format json` | **Yes** | Raw page JSON used to render the result. |

Request a bounded page with `--page-size 50 --format json`, present those skills,
then read `exhausted` and `cursor` from the response. If `exhausted` is `false`
there are more. Tell the user and offer to fetch the next page with
`--cursor <cursor>`. Do not silently page through the whole catalog.

**Presenting results (use this exact format).** Render the skills as this table,
sorted by name, and nothing else (no commands, URLs, flags, or cursors):

| Skill | Last updated |
|-------|-------------|
| `<name>` | `<lastUpdated>` |

For a `--name` search with no matches, reply with one line instead:

> No skills match "`<query>`".

To offer a follow-up (a skill's versions or repos), ask in plain language
("want the versions for one of these?") and run the command yourself.

## Requests for blocked or missing results

Never omit `--allowed-only`, even when the user asks to see everything, blocked
skills, disallowed skills, or the contents of a repo absent from the results.
Never run another command to infer or expose what filtering removed.

Only when the user asks about blocked or missing results, reply:

> The listing is always governance-filtered. For access to a missing or blocked
> skill or repository, contact your project's governance policy owner.

Otherwise, present the results simply as the list. Do not mention filtering, the
flag, or its mechanism.

## List a repo's skills

To see what is published in one specific skills repository (for example, to check
a repo before or after publishing to it), list it directly with the CLI. This is
repo-scoped (Artifactory registry contents), unlike `--list-skills`, which is
project-scoped:

```bash
jf skills list --repo "<repo>" --server-id "<SID>" --format json
```

Never run a bare `jf skills list` (it errors): always pass `--repo <key>` here, or
`--harness <h>` for installed skills (see `managing-installed-skills.md`).
Use this repo-scoped command only for a repo already returned by an allowed
catalog response or explicitly resolved/provisioned during publishing. Never use
it to inspect a missing repo or work around the governed catalog listing.

**Presenting results (use this exact format).** Render the skills as this table,
sorted by name, and nothing else (no commands, URLs, or flags):

Skills in `<repo>`:

| Skill | Version | Description |
|-------|---------|-------------|
| `<name>` | `<version>` | `<description>` |

Include the **Description** column only when the listing provides one (drop it if
every skill's description is empty). If the repo holds no skills, reply with one
line instead:

> No skills published in `<repo>`.

## A skill's versions, then its hosting repos

This is a two-step reveal, not one combined table: show versions first, and
only surface repos once the user has picked a specific version. Both steps
read from the **same** query's result — do not start a new, separate query
for the repo step. That query itself can span multiple pages (see below); "the
same result" means the one fully-paged, merged result, not a single HTTP call.

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard \
  --list-skill-versions --project "<PROJECT>" --skill "<slug>" --allowed-only [--server "<SID>"] [--cursor <C>] --format json
# JSON: versions[].version, versions[].locations[].repoKey, versions[].locations[].allowStatus, exhausted, cursor
```

**This call can be paginated — read every page before treating the result as
complete.** Unlike `--list-skills` (a browsing list, where stopping at one
page and offering more is a fine UX tradeoff), this call feeds a version/repo
*decision*: a truncated result here isn't a UX compromise, it's a wrong
answer — a real newer version, or a repo that only hosts a later version,
could be sitting on a page you never fetched. If `exhausted` is `false`, keep
calling with `--cursor <cursor>` (same `--skill`/`--allowed-only`) and merge
every page's `versions[]` into one combined list before doing anything else.
Only once `exhausted` is `true` do you have a complete result to run the
version-first / repo-second reveal on. Do this silently — do not narrate
paging to the user or ask if they want more, and never repeat the call for a
page you've already fetched.

Skill identity is **name+version+repository-path, not just name+version**
(MLAI-1309): the same slug and version can exist as genuinely different
skills in different repos, so a name+version match alone is never proof two
entries are the same skill. Each `locations[]` entry carries its own
`allowStatus` — a repo's governance status is a per-repo fact, never a
per-version one. Because `--allowed-only` is always on, every repo that comes
back is allowed; a version whose only host repo is blocked simply won't
appear.

**Step 1 — present versions only (use this exact format).** Newest version
first. Do **not** include a repos/"Hosted in" column here — repos are a
separate reveal in step 2:

Versions of `<slug>`:

| Version |
|---------|
| `<version>` |

Then ask which version the user wants (to install, or just to see where it's
hosted) — use the agent surface's native single-choice picker when one is
available (one option per version, newest first), otherwise ask in plain
language. Do not assume the newest one.

**Step 2 — once a version is chosen, present its repos (use this exact
format).** Filter the already-fetched `locations[]` down to that one version
— no new API call:

Repos hosting `<slug>@<version>`:

| Repo |
|------|
| `<repoKey>` |

Every repo listed here is governance-allowed (the filter is always on), so
do **not** annotate rows with a status suffix — an "(allowed)" tag on every
row is noise. Agent Guard's own compact TSV does print `<repoKey> (allowed)`;
strip that when rendering this table.

- **Exactly one repo.** State it plainly ("hosted in `<repoKey>`") — no need
  to ask the user to choose.
- **More than one repo.** Never auto-pick or merge. Ask which repo they mean
  before doing anything further (installing, etc.) — use the agent surface's
  native single-choice picker when one is available (one option per
  `repoKey`), otherwise render the table above and ask in plain language. See
  `installing-skills.md`'s *Resolve the repo*.
