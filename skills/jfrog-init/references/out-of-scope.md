# Non-goals (out of scope for this skill)

- Installing the JFrog IDE plugin, or replacing its auto-config.
- Installing the VS Code hook.
- A first-MCP wizard for an empty catalog.
- Persisting the picked **project key** to `JF_PROJECT` or any shell
  profile. Step 6 asks every walk and threads the pick forward as a
  positional argument only — nothing about project selection ever
  touches a shell profile. (Two other, unrelated things in this walk
  *do*: Step 1's `nvm`-based Node install, and Step 2's Plan C fallback
  when npm itself isn't usable — both append one PATH line to the
  user's shell rc file, disclosed up front in the install consent
  prompts, see `node-install-prompt.md` / `jf-cli-install-prompt.md`.
  Plans A/B of Step 2 — the common case — don't touch a shell profile
  at all, relying on npm's own global bin directory instead.)
- Granting AI Catalog roles/permissions — Step 7 only instructs.
- Storing access tokens to disk, logging them, or printing them.
  Step 4's authenticated check keeps the credential inside `jf`'s own
  process (`jf rt ping`); Steps 6 and 7 extract it from `jf config
  export` only in memory, for one `fetch` call. Step 3/4's token-based
  `jf config` path (see `references/jf-config-auth-picker.md`) never
  touches this skill or the model at all — the user runs that command
  themselves. **Step 8 is the one deliberate exception** — it writes
  the token to `~/.netrc`; see `references/marketplace-setup.md`.
