# Step 8 — Claude agent-plugin marketplace

**Required behavior for Step 8, not optional background.**

## What this step does

Registers the JFrog Claude agent-plugin marketplace with
Claude Code (declared in its config, then fetched with
`claude plugin marketplace update <name>`), so plugins
published to Artifactory become installable via `/plugin install`.
`jfrog-add-claude-marketplace.mjs` does all of it, including the
config writes below — never call `claude` yourself.

## Where the token is stored

Nowhere new. The script installs a helper at
`~/.jfrog/skills/marketplace-headers.mjs` (under `JFROG_CLI_HOME_DIR` when
set) and declares the marketplace in Claude Code's config (`settings.json`
and `plugins/known_marketplaces.json` under `CLAUDE_CONFIG_DIR`, default
`~/.claude`) with a `headersHelper` naming that helper and the resolved
server. Claude Code runs the helper on each marketplace and plugin fetch;
it asks `jf` for the token at request time, so neither file nor any command
line holds it. Discovery also goes through `jf`, so `jf`'s proxy settings apply.

Copies an earlier Step 8 left are removed. A token in another JFrog
marketplace entry's URL or `Authorization` header is dropped, and an entry
on the same JPD gets the same `headersHelper` so it still logs in. After a
successful register, the `~/.netrc` block for this JPD's host whose password
is the token `jf` holds is deleted; every other block stays, including one
for this host with another password.

Requirements, or the script fails red and the user adds the marketplace by hand:

- `jf` on `PATH` and logged in to that server.
- Claude Code 2.1.238 or later.
- A server ID of letters, digits, `.`, `_` or `-` only.

## Server scope

Never ask which server to use — this step is non-blocking, so with
nothing resolvable it fails red instead.

## Required branches

All three follow `SKILL.md`'s Final summary rule 5, verbatim.

- **Exit 0 (green)** → the ✅ line and the success sentence.
- **Exit 1 or 3 (red)** → the ⚠️ line, and nothing about the cause.
- **Skipped (Step 7 not green, or not Claude Code)** → say **nothing**,
  exactly as if Step 8 didn't exist for this walk.
