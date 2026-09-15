# Contributing to JFrog Skills

Guidelines for agents and humans contributing to this repository.

## Skill Naming Convention

All skill names must have a `jfrog-` prefix and be named by the **functionality they solve**, not by the JFrog service that implements it.

- Good: `jfrog-artifact-operations`, `jfrog-security-scanning`, `jfrog-build-operations`
- Bad: `artifactory`, `xray`, `access`, `pipelines` (service names)
- Bad: `artifact-operations` (missing `jfrog-` prefix)

The name should describe what the user is trying to do, not which backend service handles it.

## Command Naming Convention

Any command or script added to this repository must start with `jfrog` (e.g., `jfrog-validate-skill`, `jfrog-run-tests`). This ensures clear namespacing and avoids collisions with other tools.

## Directory Structure

All skills live directly under `skills/<name>/` -- flat structure, never nested into subdirectories like `skills/base/` or `skills/workflows/`. Layering (base vs workflow) is expressed through SKILL.md metadata and prerequisites, not through directory hierarchy.

## SKILL.md layout (primacy / recency)

Session invariants / long skills: top `## At a glance (always-read core)` + tail
`## Before you run … checklist`. Canonical pattern + summary fidelity:
[`.cursor/skills/skill-authoring/references/instruction-patterns.md`](.cursor/skills/skill-authoring/references/instruction-patterns.md).
**Gotchas / caveats / known issues / do-don'ts / strict enforcements** must
never be framed as optional or on-demand — see that file → Gotchas / hard
rules. Enforcement: [`.cursor/rules/skill-validation.mdc`](.cursor/rules/skill-validation.mdc).
Examples: `skills/jfrog/SKILL.md`, `skills/jfrog-setup-package-managers/SKILL.md`.

## Local Development

Symlink `skills/` into your global agent scope so edits apply immediately:

```bash
make skills-install    # link skills/ → ~/.agents/skills and ~/.claude/skills
make skills-status     # verify link state
make skills-remove     # unlink before enabling the Claude plugin beta (avoids duplicates)
```

Skills are discovered automatically from `skills/*/SKILL.md` — no per-skill configuration.

Some contract tests are pytest-based and fail closed without it, so install the
pinned version before running `make test-contracts` (pin: `CI_PYTEST_VERSION` in
`.github/workflows/build.yml`):

```bash
pip install "pytest==8.4.2" "pyyaml==6.0.2"
```

## Base vs Workflow Skills

- **`jfrog`** is the base skill. It provides foundational JFrog knowledge, CLI setup instructions, and routes to workflow skills via internal references.
- **All other skills** are workflow skills. They declare `jfrog` as a prerequisite in their SKILL.md header.
- The base skill references workflow skills for routing; workflow skills reference the base for foundational context.
- **The base skill must never use `load skill` to reference workflow skills.** It must be fully self-contained — users may install only the base skill. Use `references/` files within the base skill for any content that needs to be accessible without workflow skills installed. This is enforced by CI validation.

## Skill Structure

Every skill lives in `skills/<name>/` and must contain at least a `SKILL.md`. Optional: a `references/` subdirectory for CLI command patterns and API reference docs.

## Customer-facing skill content only

Everything under `skills/` is **published** (see `.dist-include`) and is what
`skill-validator` token-counts. Put **only** customer-facing agent content there:

| Location | What belongs | Token gate |
|----------|--------------|------------|
| `skills/<name>/SKILL.md` | Agent instructions | Soft warn ~5k tokens / 500 lines |
| `skills/<name>/references/*.md` | On-demand agent references | Hard fail at **50k** aggregate |
| `skills/<name>/assets/` | Customer-facing templates / static assets | Counted separately (100k other/assets budget) |
| `skills/<name>/scripts/` | Runnable helpers (not loaded into context as prose) | Not in the refs total |

**Do not** put maintainer-only or internal process notes under `skills/`.
Those live in `docs/` (not distributed, not validated as skill tokens).

## No Internal Test Data

No references to internal JFrog environments, instance names, or specific internal projects/repos/packages/builds are allowed anywhere in this repo. Specifically:

- Never use real internal server names or any specific `*.jfrog.io` instance
- Use generic public packages: `lodash`, `spring-boot-starter-web`, `commons-lang3`, `guava`
- Use placeholder names for repos: `libs-release-local`, `npm-remote`, `docker-local`
- Use placeholder instance URLs: `https://mycompany.jfrog.io`

This applies to skills, reference files, test prompts, and all documentation.

## Commit Messages

Write clear, concise commit messages that describe what the change does. Start
with a capital letter, use imperative mood.

Examples:
- `Add package safety workflow skill`
- `Fix credential extraction for non-default servers`
- `Update AQL syntax reference with date-range examples`

## Versioning

This project uses `0.x` versioning while in beta. The `1.0` release will be tagged once skills graduate from beta after sufficient validation and customer feedback.

## Downstream Plugin Sync

Production releases (`release.yml` → distribute to `github.com/jfrog/jfrog-skills`)
end with a public `v*` tag. That repo's `Sync Plugins` workflow opens a PR in every
plugin listed in `.github/plugins.json` (use each entry's exact `name` — the
github.com repo slug under `jfrog/`). Each PR vendors `skills/` at the tagged ref.
Plugin teams review and merge manually.

This GHE repo keeps a mirror of `.github/plugins.json` for the `/release` skill and
post-distribute notify. Prefer the interactive **`/release`** skill for production cuts;
use **`release-testing`** for milestone/test pipeline checks. Slack channel IDs, bot
names, and other ops routing live in [`.github/RELEASE_PIPELINE.md`](.github/RELEASE_PIPELINE.md)
(internal; not distributed to the public skills repo).

### To add or remove a plugin

Updating `.github/plugins.json` (GHE + public) is necessary but not sufficient.
For each new `jfrog/<repo>`:

1. **Public** `jfrog/jfrog-skills` `.github/plugins.json` — exact GitHub repo
   `name`, `dest_prefix`, and `version_bumps` / `pin_updates` as needed.
2. **GHE** `JFROG/jfrog-skills` `.github/plugins.json` — must match public. This
   is what notify-slack and `/release` read. Do **not** add a second hard-coded
   repo list in `release.yml`; the workflow reads this JSON (token mint is
   owner-scoped with `permission-pull-requests: read`).
3. **GitHub App** `PUBLIC_REPO_APP_ID` — install (or add to selected repos) on
   that repository. notify-slack warns when a `plugins.json` name is outside
   the installation and skips polling it.
4. **PLUGIN_SYNC_TOKEN** / public Sync Plugins App — Contents: write and Pull
   requests: write on that repo.
5. **Live-check shape** — if the plugin publishes GitHub Releases
   (`version_bumps`), post-release uses `gh release view`; if it is pin-only
   (`pin_updates` only, e.g. `jetbrains-plugin`), confirm the pin file on
   `main` instead of a tag.
6. **Versions dashboard** — add the repo to
   `.cursor/skills/skills-versions-report/config/sources.json` if it should
   appear on `/versions/` (that list is separate from `plugins.json`).

Use the `name` field as the github.com repo slug. Do **not** document nicknames
(`opencode`, `kiro`, `jetbrains`, `devin-extension`).

Each entry has:

- `name` — repo name under the `jfrog/` GitHub org (exact slug)
- `dest_prefix` — prefix inside the plugin repo where `skills/` should land. Empty string means repo root.

Example: `{ "name": "cursor-plugin", "dest_prefix": "plugins/jfrog" }` copies this repo's `skills/` to `jfrog/cursor-plugin` at `plugins/jfrog/skills/`.

To re-trigger a sync for an existing tag, run Sync Plugins on the **public** repo and pass the tag as the `version` input.

### Required setup

- Public Sync Plugins auth: App / token with `Contents: write` and `Pull requests: write` on every plugin listed in `plugins.json`.
- GHE Slack notify secrets/vars: see [`.github/RELEASE_PIPELINE.md`](.github/RELEASE_PIPELINE.md).

## Contributor License Agreement

Contributions to this project require signing the [JFrog CLA](https://jfrog.com/cla/) before your first pull request can be merged.
