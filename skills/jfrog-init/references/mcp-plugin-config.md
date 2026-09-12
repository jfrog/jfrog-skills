# Step 5 — plugin-owned mcp.json: mechanics and per-harness paths

Background for Step 5 of `/jfrog-init` (`SKILL.md`). The model doesn't
need this to execute the step — `jfrog-detect-jfrog-mcp.mjs` handles
detection, substitution, and (OpenCode only) writing a new entry, and
reports the result as JSON — but it's useful for debugging a red/error
result or explaining what happened.

**Placeholder substitution (Cursor / VS Code / Claude Code).** The
plugin sometimes ships an `mcp.json` where the JPD URL is a placeholder
that would otherwise need to be resolved at runtime from an env var:

```json
{"mcpServers": {"jfrog": {"url": "https://${JFROG_PLATFORM_URL}/mcp"}}}
```

Codex's plugin ships the same idea in a different shape — no
`mcpServers` wrapper, and angle brackets instead of `${...}`:

```json
{"jfrog": {"url": "https://<JFROG_PLATFORM_URL>/mcp"}}
```

The VS Code plugin uses VS Code's own env-var syntax, with an `env:`
prefix inside `${...}`:

```json
{"mcpServers": {"jfrog": {"type": "http", "url": "https://${env:JFROG_PLATFORM_URL}/mcp"}}}
```

The Copilot extension **does not** expand `${env:VAR}` before loading
the MCP, so leaving the placeholder in place also silently fails to
connect; Step 5 substitutes it the same way as the others.

Because we have that URL sitting in `jf config`, and because leaving
the placeholder in place means the MCP silently fails to load in the
IDE / agent, Step 5 auto-substitutes it. If the detector finds the
placeholder pattern anywhere in the file, it calls
`jfrog-substitute-mcp-placeholders.mjs`, which:

1. Parses the file as JSON and looks **only** at the `jfrog` entry's
   `url` (nested under `mcpServers` on every harness but Codex, which
   has no wrapper) — never a file-wide text replace, so an unrelated
   MCP server entry or JSON value that happens to contain the same
   placeholder text is never touched.
2. Reads the JPD URL from `jf config` (default server, or the one
   passed as arg 2), normalizes it to the JPD root, and substitutes it
   into that one `url` string.
3. Replaces in two passes — first a placeholder preceded by a scheme
   (`https://${...}`, where our own scheme would otherwise double up),
   then a bare one. Each pass recognizes four syntaxes: `${VAR}`,
   VS Code's `${env:VAR}`, bare `$VAR`, and Codex's `<VAR>`.
4. Re-serializes the whole file (`JSON.stringify(parsed, null, 2)`) and
   writes atomically (temp file + rename) so a partial write cannot
   corrupt the file. Original formatting/whitespace elsewhere in the
   file is not preserved byte-for-byte.
5. Is idempotent — subsequent runs find no placeholder and no-op.

This is the ONLY place `/jfrog-init` writes to the plugin-owned
`mcp.json` for these three harnesses. Everything else in Step 5 is
read-only for them — with two further exceptions: OpenCode and Kiro CLI
(see below).

**OpenCode is structurally different.** The JFrog OpenCode plugin
(`@jfrog/opencode-jfrog-plugin`) ships no static `mcp.json` of its
own — it injects an `mcp.jfrog` entry into OpenCode's in-memory config
at startup, via a `config` hook, but **only when `$JFROG_PLATFORM_URL`
is set**. `/jfrog-init` deliberately does not rely on that env var —
the JPD URL is already known from `jf config`, the same as every other
harness — so instead it writes the entry directly into the **user's
own** OpenCode config file:

```json
{"mcp": {"jfrog": {"type": "remote", "url": "https://acme.jfrog.io/mcp", "enabled": true}}}
```

If the detector finds no `mcp.jfrog` entry at all (the expected steady
state until this runs once), it calls `jfrog-write-opencode-mcp.mjs`,
which:

1. Parses the file as **strict JSON**. If that fails — most often
   because it's an `opencode.jsonc` with comments, which a
   `JSON.parse`/`JSON.stringify` round-trip would silently destroy —
   it refuses to write and reports an error instead; Step 5 falls back
   to a manual-paste instruction (see
   `jfrog-reinstall-jfrog-plugin.mjs`'s OpenCode branch) rather than
   risking comment loss.
2. Never overwrites an existing `mcp.jfrog` entry — same behavior as
   the plugin's own runtime injection, and it protects any manual
   configuration the user already has.
3. Reads the JPD URL from `jf config` (default server, or the one
   passed as arg 2) and writes `{"type": "remote", "url": "<jpd>/mcp",
   "enabled": true}` under `mcp.jfrog`.
4. Re-serializes the whole file and writes atomically (temp file +
   rename), same as the placeholder substituter.
5. Is idempotent — subsequent runs find the entry already present and
   no-op.

This is the ONLY place `/jfrog-init` writes to the user's own OpenCode
config, and the only Step 5 write that targets a file NOT owned by the
plugin (there is no plugin-owned file for OpenCode to write to).

**Per-harness plugin-owned config file:**

| Harness      | Plugin-owned config file |
|--------------|--------------------------|
| Cursor       | `~/.cursor/plugins/cache/cursor-public/jfrog/<sha>/mcp.json` (glob → newest) |
| VS Code      | `~/.vscode/agent-plugins/github.com/jfrog/vscode-plugin/plugin/.mcp.json` |
| Claude Code  | `~/.claude/plugins/cache/<marketplace>/jfrog/<version>/.mcp.json` (glob) |
| Codex        | `$CODEX_HOME/plugins/cache/codex-plugin/jfrog/<version>/.mcp.json` (glob → newest; `$CODEX_HOME` defaults to `~/.codex`) |
| OpenCode     | *(no plugin-owned file — see above)* |
| Kiro (IDE)   | `~/.kiro/powers/installed/jfrog-kiro-power/mcp.json` (stable path) |
| Kiro CLI     | `~/.kiro/settings/mcp.json` — Kiro's own global MCP config, not shipped by any plugin, so the `jfrog` entry is **created or merged in** with a placeholder url, then substituted like every other row above |
| Devin        | `~/.local/share/devin/cli/plugins/cache/github.com_jfrog_devin-plugin-<sha>/<version>/mcp.json` (glob → newest; the scan is restricted to slugs starting with `github.com_jfrog_devin-plugin-` so other Devin plugins that also ship an `mcp.json` can't be picked up by mistake) |

**OpenCode's own config file** (not plugin-owned — this is the user's
personal config). The global file (item 3 below) is **always** loaded by
OpenCode; `$OPENCODE_CONFIG` / `$OPENCODE_CONFIG_DIR` each add a second
file merged on top of it — they do **not** replace it (see
[harness-opencode.md](../../jfrog-mcp-management/references/harness-opencode.md)).
`$OPENCODE_CONFIG` is honored as the write target (the file must already
exist on disk — start OpenCode once to initialize it):

1. `$OPENCODE_CONFIG`, if set (an explicit file path override).
2. `$OPENCODE_CONFIG_DIR/opencode.json[c]`, if `$OPENCODE_CONFIG_DIR` is set.
3. `~/.config/opencode/opencode.json` (or `.jsonc`, if that's the one
   that already exists) otherwise — the global file OpenCode always loads
   (honors `$XDG_CONFIG_HOME`). Not a macOS/Linux-only example: neither
   OpenCode nor this resolver translates it on Windows, so the literal
   path there is `homedir()\.config\opencode\opencode.json` (e.g.
   `C:\Users\<user>\.config\opencode\opencode.json`) — no `%APPDATA%`.
   Confirmed live on Windows: a fresh install's first run creates exactly
   that path (as `opencode.jsonc`, its default first-run format).

Whenever the write target picked from 1 or 2 above isn't the global file
itself, `jfrog-resolve-mcp-config.mjs` also returns the global file as
`layerPaths`, and `jfrog-detect-jfrog-mcp.mjs` checks it for an existing
`mcp.jfrog` entry before writing — deferring to that entry instead of
writing a second one into the override file, which OpenCode's merge would
otherwise let shadow it.

Project-scope `opencode.json` (in the project root) is deliberately
**never** used — a project config is often committed to git, and writing
a `jfrog` MCP entry into a file the user might share is a different
action than writing to a personal, git-ignored config.

The Kiro CLI merge is additive and never destructive: the file normally
holds the user's other MCP servers, so a `jfrog` entry that already has a
url is left untouched (a placeholder in it is the substitution step's
job), other servers and the file's mode are preserved, a symlinked config
stays a symlink, and a file that isn't valid JSON is reported rather than
rewritten.

Harness detection (in priority order): `CODEX_SANDBOX` / `CLAUDECODE` /
`CURSOR_TRACE_ID` / `OPENCODE` / `OPENCODE_SESSION_ID` / `VSCODE_PID` /
`TERM_PROGRAM`. Override with
`JFROG_INIT_HARNESS=claude|cursor|vscode|codex|opencode|kiro|kiro-cli|devin`
or a specific file via `JFROG_INIT_MCP_CONFIG=/abs/path`. Kiro / Kiro CLI /
Devin have no auto-detect signal, and the Copilot extension runtime
may sanitize VS Code's env vars from the plugin subprocess — all four
are reachable via the matching `JFROG_INIT_HARNESS=...` override,
exported from Step 5 in `SKILL.md`.

`SKILL.md`'s Step 5 already has you export `JFROG_INIT_HARNESS=kiro` /
`kiro-cli` / `vscode` / `devin` up front when you're running as one of
those targets — before the detector ever runs, so Exit 3 below isn't
the trigger for it.

**What the detector verifies** (three things):

1. Config file exists and is non-empty at its harness-specific path.
2. Parses as valid JSON.
3. Contains a `jfrog` entry (`mcpServers.jfrog` on Cursor/VS Code/Claude
   Code, bare top-level `jfrog` on Codex, `mcp.jfrog` on OpenCode) with
   a non-empty `url`. An entry that exists but has a missing or empty
   `url` also causes a red — fix or remove the entry and re-run.

It does NOT enforce any other `type`/`url` shape (each plugin owns its
own schema), and does NOT probe the endpoint — whether the server is
actually enabled on the JPD is a separate, network check (see
"MCP-responding probe" below).

**Step 5 branches, required behavior:**

- **Exit 0 (green)** → proceed to Step 6.
- **Exit 1 (red)** or **Exit 3 (error)** → **non-blocking** — proceed
  to Step 6 as if green, but remember the cause for the Final Summary.
  Steps 6 and 7 call the JPD's REST APIs directly with `jf config`
  credentials, never through the `jfrog` MCP entry, so a broken or
  missing config doesn't affect whether those checks are accurate —
  there's nothing to gain by stopping the walk over it. Tell the
  causes apart from the detector's `detail` for the Final Summary
  note:
  - **(Cursor / VS Code / Claude Code / Codex / Kiro IDE)** Plugin file
    missing / empty / lacks a valid `jfrog` entry. Fix: **reinstall or
    update the JFrog plugin.** If the user asks why or how to fix it, run:

    ```bash
    node "${CLAUDE_SKILL_DIR}/scripts/jfrog-reinstall-jfrog-plugin.mjs"; true
    ```

    and relay its per-harness remedy — it only diagnoses and prints,
    never writes to the plugin's mcp.json.
  - **(Cursor / VS Code / Claude Code)** Plugin file has a placeholder
    and automatic substitution failed with no url set for the resolved
    server-id. Fix: **resolve `jf config`**. Reinstalling the plugin
    does not fix this.
  - **(OpenCode)** Config has no `mcp.jfrog` entry and the automatic
    write failed — either no `jf` server resolvable (fix: **resolve
    `jf config`**) or the file isn't strict JSON (fix: **paste the
    entry in manually** — run `jfrog-reinstall-jfrog-plugin.mjs` for
    the exact JSON to paste and where).
  - **(Kiro CLI)** Could not create or update `~/.kiro/settings/mcp.json`
    — no plugin ships this file, so there's nothing to reinstall. The
    detail names the actual cause. Fix: **correct the file or
    parent-directory permissions/path**, then re-run.
  - (Exit 3 only) Harness could not be detected, or the config file is
    invalid JSON / unreadable. Show the raw detector error in the note.
    **Do not react to this by guessing a harness or trying
    `JFROG_INIT_HARNESS` values to see what resolves it.** If this is
    Kiro, Kiro CLI, or Copilot in VS Code, the override was already
    exported before the detector's first run (top of Step 5), so it
    should not reach Exit 3 for that cause at all. Otherwise this is
    Exit 3, non-blocking
    like every other cause above: note it and move on to Step 6 in the
    same turn, with zero visible pause — do not stop to read this file
    or any other reference doc over it.
- **Exit 2 (`ask`)** → the one outcome that still blocks: a fix needs
  the jf server-id (placeholder substitution on Cursor/VS Code/Claude
  Code, or the initial write on OpenCode/Kiro CLI) but it's ambiguous —
  every step from here on needs a resolved server-id, so there's nothing
  to skip ahead to. **Stop and read `references/server-picker.md` in
  full**, then re-invoke with the pick as the positional argument.

**Note on Claude Code**: today the released Claude JFrog plugin does
not include a `.mcp.json` in its shipped tree, so Step 5 goes red on
Claude Code until the plugin ships one — this no longer stops the
walk, but the Final Summary still notes it. Never fall back to
project-scope `.mcp.json`.

## Step 5b (OpenCode only) — MCP auth token

Step 5 wires the `mcp.jfrog` *address*; OpenCode's `"type": "remote"` entry
also needs its own OAuth token before MCP tools work. That token lives in
`~/.local/share/opencode/mcp-auth.json` (honors `$XDG_DATA_HOME`), keyed
by server name (`jfrog`), managed by OpenCode — never by this skill. Same
un-translated path on Windows (`homedir()\.local\share\opencode\mcp-auth.json`,
no `%LOCALAPPDATA%`) — see the config-path note above. The parent directory
(`.local\share\opencode`) is confirmed live on Windows, holding OpenCode's
db/log/repos; the `mcp-auth.json` file itself only appears after an actual
OAuth handshake, not from an install alone, so its exact path is inferred
from source (`packages/opencode/src/mcp/auth.ts` in `anomalyco/opencode`),
not observed directly.

A non-empty `jfrog` key in that file is **not** proof of a working credential:
OpenCode writes PKCE state there *before* the browser redirect and only adds
`tokens.accessToken` once the OAuth callback completes. A user who started
but never finished the browser login is left with a key but no token.
`jfrog-detect-opencode-mcp-auth.mjs` checks `tokens.accessToken` specifically.

The auth command is interactive (opens a browser, blocks up to 60s) — no
non-interactive form exists. The script is read-only; the fix is always
the user running `opencode mcp auth jfrog` themselves.

**Exit codes:** 0 = token present; 1 = missing or incomplete (tell user to
run `opencode mcp auth jfrog`, non-blocking); 3 = file unreadable/invalid
JSON (non-blocking, note in Final Summary). Never runs on Cursor/VS
Code/Claude Code — those use `jf config` credentials directly.

## MCP-responding probe — is the server enabled on this JPD?

The config check proves the plugin's `mcp.json` is wired up, not that a
Platform Admin has **enabled** the JFrog MCP server. An enabled endpoint is
OAuth-protected (it answers a Bearer challenge); until an admin enables it,
`<JPD>/mcp` has no challenge — a bare 403 on SaaS, or 404 self-managed.
After the config check, run once:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jfrog-mcp-responding.mjs" "[server-id]"; rc=$?; true
```

No result here stops `/jfrog-init` — the walk always finishes, and it never
pauses for MCP sign-in mid-way; any sign-in offer waits until **after the Final
Summary**. When the config check was green, the **probe decides** the Final
Summary's **JFrog MCP Plugin** line, because it is the only signal tied to
*this* JPD.

> Note: the JFrog MCP tools you can see may belong to a *different* JPD (you can
> be signed in to JPD-A while probing JPD-B), so they confirm sign-in only when
> they target *this* JPD's base URL, and **never** turn a `not_enabled` or
> `unreachable` probe green.

- **Exit 4 (`not_enabled`)** → `not enabled on this JPD`, plus the fix from the
  detector's `detail` (*ask your JFrog platform admin to enable it*, with the
  docs link `https://docs.jfrog.com/integrations/docs/enable-the-jfrog-mcp-server`).
- **Exit 1 (`unreachable`)** → `could not confirm it's enabled`. Often transient
  (proxy / VPN / timeout); re-run to recheck.
- **Exit 0 (`enabled`)** → this JPD's MCP is on. Read sign-in from your session's
  JFrog MCP tools (they count only for *this* JPD — see the note above):
  - **Tools available and for this JPD** (same base URL) → green (signed in).
  - **Not available, `needsAuth`, or not confirmably this JPD** → the summary
    line is `enabled — sign in to use it`. Step 5 is non-blocking, so do **not**
    open the browser here — offer to sign in only **after the Final Summary**
    (the walk's one browser action, and its last). If the user accepts, trigger
    the JFrog MCP's own sign-in through your harness's MCP auth, then follow up:
    tools now visible → connected; still not visible → reload the window to load
    them (expected — don't ask an already signed-in user to sign in again).

The result is in `jfrog-detect-all.mjs`'s summary as `mcpResponding`
(with `mcpRespondingReason` on the non-green cases). The auth-status read
above is an agent-level check, not part of that script's output.
