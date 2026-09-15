# Discovering plugins

List-all and versions go through the **Agent Guard**.

## List plugins (page through the catalog)

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard \
  --list-agent-plugins --project "<PROJECT>" [--name <PATTERN>] [--server "<SID>"] [--page-size <N>] [--cursor <C>] [--format json]
```

| Flag | Required | Purpose |
|------|----------|---------|
| `--project <PROJECT>` | **Yes** | AI Catalog project to list. |
| `--name <PATTERN>` | No | Find plugins by name: server-side, case-insensitive substring, scoped to the project. |
| `--server <SID>` | No | jf CLI config entry to authenticate with (defaults to the resolved single server). |
| `--page-size <N>` | No | Results per page. Pass `50` to stay bounded. The Agent Guard defaults to 500 if omitted. |
| `--cursor <C>` | No | Continuation cursor from a previous page's JSON, to fetch the next page. |
| `--format json` | No | Raw page JSON instead of the default compact TSV (name + last-updated). |

Request a bounded page with `--page-size 50 --format json`, present those plugins,
then read `exhausted` and `cursor` from the response. If `exhausted` is `false`
there are more. Tell the user and offer to fetch the next page with
`--cursor <cursor>`. Do not silently page through the whole catalog.

**Presenting results (use this exact format).** Render the plugins as this table,
sorted by name, and nothing else (no commands, URLs, flags, or cursors):

| Plugin | Last updated |
|--------|-------------|
| `<name>` | `<lastUpdated>` |

For a `--name` search with no matches, reply with one line instead:

> No plugins match "`<query>`".

To offer a follow-up (a plugin's versions or repos), ask in plain language
("want the versions for one of these?") and run the command yourself.

## List a repo's plugins

To see what is published in one specific plugins repository (for example, to check
a repo before or after publishing to it), list it directly with the CLI. This is
repo-scoped (Artifactory registry contents), unlike `--list-agent-plugins`, which is
project-scoped:

```bash
jf agent plugins list --repo "<repo>" --server-id "<SID>" --format json
```

Never run a bare `jf agent plugins list` (it errors): always pass `--repo <key>` here, or
`--harness <h>` for installed plugins (see `managing-installed-plugins.md`).

**Presenting results (use this exact format).** Render the plugins as this table,
sorted by name, and nothing else (no commands, URLs, or flags):

Plugins in `<repo>`:

| Plugin | Version | Description |
|--------|---------|-------------|
| `<name>` | `<version>` | `<description>` |

Include the **Description** column only when the listing provides one (drop it if
every plugin's description is empty). If the repo holds no plugins, reply with one
line instead:

> No plugins published in `<repo>`.

## A plugin's versions and hosting repos

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard \
  --list-agent-plugin-versions --project "<PROJECT>" --agent-plugin "<slug>" [--server "<SID>"] [--page-size <N>] [--cursor <C>] [--format json]
# JSON: versions[].version, versions[].locations[].repoKey (page through with cursor like above)
```

**Presenting versions (use this exact format).** Newest version first:

Versions of `<slug>`:

| Version | Hosted in |
|---------|-----------|
| `<version>` | `<repoKey>`[, `<repoKey>`…] |
