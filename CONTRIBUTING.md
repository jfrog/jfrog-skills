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

## Local Development

Symlink `skills/` into your global agent scope so edits apply immediately:

```bash
make skills-install    # link skills/ → ~/.agents/skills and ~/.claude/skills
make skills-status     # verify link state
make skills-remove     # unlink before enabling the Claude plugin beta (avoids duplicates)
```

Skills are discovered automatically from `skills/*/SKILL.md` — no per-skill configuration.

## Base vs Workflow Skills

- **`jfrog`** is the base skill. It provides foundational JFrog knowledge, CLI setup instructions, and routes to workflow skills via internal references.
- **All other skills** are workflow skills. They declare `jfrog` as a prerequisite in their SKILL.md header.
- The base skill references workflow skills for routing; workflow skills reference the base for foundational context.
- **The base skill must never use `load skill` to reference workflow skills.** It must be fully self-contained — users may install only the base skill. Use `references/` files within the base skill for any content that needs to be accessible without workflow skills installed. This is enforced by CI validation.

## Skill Structure

Every skill lives in `skills/<name>/` and must contain at least a `SKILL.md`. Optional: a `references/` subdirectory for CLI command patterns and API reference docs.

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
plugin listed in `.github/plugins.json` (cursor, claude, **vscode**). Each PR vendors
`skills/` at the tagged ref. Plugin teams review and merge manually.

This GHE repo keeps a mirror of `.github/plugins.json` for the `/release` skill and
post-distribute notify. Prefer the interactive **`/release`** skill for production cuts;
use **`release-testing`** for milestone/test pipeline checks. Slack channel IDs, bot
names, and other ops routing live in [`.github/RELEASE_PIPELINE.md`](.github/RELEASE_PIPELINE.md)
(internal; not distributed to the public skills repo).

To add or remove a plugin, update `.github/plugins.json` here **and** on the public
skills repo. Each entry has:

- `name` — repo name under the `jfrog/` GitHub org
- `dest_prefix` — prefix inside the plugin repo where `skills/` should land. Empty string means repo root.
- `version_bumps` (optional) — `{file, path}` entries; each JSON semver field is patch-bumped when the sync produces changes.
- `pin_updates` (optional) — `{file, path}` entries; each vendor-pin field (e.g. `.github/scripts/sync-skills-vendor.json` → `pin`) is set to the synced tag. Required for plugins whose CI re-vendors from that pin so the committed skills and pin stay aligned.

Example: `{ "name": "cursor-plugin", "dest_prefix": "plugins/jfrog" }` copies this repo's `skills/` to `jfrog/cursor-plugin` at `plugins/jfrog/skills/`.

To re-trigger a sync for an existing tag, run Sync Plugins on the **public** repo and pass the tag as the `version` input.

### Required setup

- Public repo secret `PLUGIN_SYNC_TOKEN`: PAT with `Contents: write` and `Pull requests: write` on every plugin listed in `plugins.json`.
- GHE Slack notify secrets/vars: see [`.github/RELEASE_PIPELINE.md`](.github/RELEASE_PIPELINE.md).

## Contributor License Agreement

Contributions to this project require signing the [JFrog CLA](https://jfrog.com/cla/) before your first pull request can be merged.
