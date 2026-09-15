# Step 8 — Claude agent-plugin marketplace

**Required behavior for Step 8, not optional background.**

## What this step does

Registers the JFrog Claude agent-plugin marketplace with
Claude Code (`claude plugin marketplace add <url>`), so plugins
published to Artifactory become installable via `/plugin install`.
`jfrog-add-claude-marketplace.mjs` does all of it, including the
`~/.netrc` write below — never call `claude` yourself.

## The `~/.netrc` write

The only file this skill creates to hold a token, so say so plainly if the
user asks. The token goes to `~/.netrc`, replacing any prior block for that
host. `claude plugin install` needs it because the marketplace lists each
plugin as a plain Artifactory URL with no credentials in it. The marketplace
fetch does not use the file, because the token passed to `claude plugin
marketplace add` reaches Claude Code's own plugin config.

## Server scope

Never ask which server to use — this step is non-blocking, so with
nothing resolvable it fails red instead.

## Required branches

All three follow `SKILL.md`'s Final summary rule 5, verbatim.

- **Exit 0 (green)** → the ✅ line and the success sentence.
- **Exit 1 or 3 (red)** → the ⚠️ line, and nothing about the cause.
- **Skipped (Step 7 not green, or not Claude Code)** → say **nothing**,
  exactly as if Step 8 didn't exist for this walk.
