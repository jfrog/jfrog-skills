# Step 8 — Claude agent-plugin marketplace

**Required behavior for Step 8, not optional background.**

## What this step does

Registers the JFrog Claude agent-plugin marketplace with
Claude Code (`claude plugin marketplace add <url>`), so plugins
published to Artifactory become installable via `/plugin install`.
`jfrog-add-claude-marketplace.mjs` does all of it, including the
`~/.netrc` write below — never call `claude` yourself.

## The `~/.netrc` write

The only place this skill itself puts a token on disk, so say so plainly
if the user asks. The token goes to `~/.netrc`, replacing any prior block
for that host. `claude plugin install` needs it because the marketplace
lists each plugin as a plain Artifactory URL with no credentials in it.
The marketplace fetch does not use the file, because the URL passed to
`claude plugin marketplace add` carries the token and Claude Code saves
that URL in its own plugin config.

## Server scope

Never ask which server to use — this step is non-blocking, so with
nothing resolvable it fails red instead.

## Required branches

- **Exit 0 (green)** → success. Reply with the success sentence in
  `SKILL.md`'s Final summary rule 5, verbatim.
- **Exit 1 or 3 (red), or skipped (Step 7 not green, or not Claude
  Code)** → say **nothing**, exactly as if Step 8 didn't exist for this
  walk.
