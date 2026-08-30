# Step 5 — plugin-owned mcp.json: mechanics and per-harness paths

Background for Step 5 of `/jfrog-init` (`SKILL.md`). The model doesn't
need this to execute the step — `jfrog-detect-jfrog-mcp.mjs` handles
detection and substitution and reports the result as JSON — but it's
useful for debugging a red/error result or explaining what happened.

**Placeholder substitution.** The plugin sometimes ships an `mcp.json`
where the JPD URL is a placeholder that would otherwise need to be
resolved at runtime from an env var:

```json
{"mcpServers": {"jfrog": {"url": "https://${JFROG_PLATFORM_URL}/mcp"}}}
```

Codex's plugin ships the same idea in a different shape — no
`mcpServers` wrapper, and angle brackets instead of `${...}`:

```json
{"jfrog": {"url": "https://<JFROG_PLATFORM_URL>/mcp"}}
```

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
   then a bare one. Each pass recognizes all three syntaxes: `${VAR}`,
   `$VAR`, and Codex's `<VAR>`.
4. Re-serializes the whole file (`JSON.stringify(parsed, null, 2)`) and
   writes atomically (temp file + rename) so a partial write cannot
   corrupt the file. Original formatting/whitespace elsewhere in the
   file is not preserved byte-for-byte.
5. Is idempotent — subsequent runs find no placeholder and no-op.

This is the only place `/jfrog-init` writes to a harness's plugin-owned
`mcp.json` — with one further exception for Kiro CLI: ensuring a `jfrog`
entry exists in `~/.kiro/settings/mcp.json`, which no plugin ships (see
below). Everything else in Step 5 is read-only.

**Per-harness plugin-owned config file:**

| Harness      | Plugin-owned config file |
|--------------|--------------------------|
| Cursor       | `~/.cursor/plugins/cache/cursor-public/jfrog/<sha>/mcp.json` (glob → newest) |
| VS Code      | `~/.vscode/agent-plugins/github.com/jfrog/vscode-plugin/plugin/.mcp.json` |
| Claude Code  | `~/.claude/plugins/cache/<marketplace>/jfrog/<version>/.mcp.json` (glob) |
| Codex        | `$CODEX_HOME/plugins/cache/codex-plugin/jfrog/<version>/.mcp.json` (glob → newest; `$CODEX_HOME` defaults to `~/.codex`) |
| Kiro (IDE)   | `~/.kiro/powers/installed/jfrog-kiro-power/mcp.json` (stable path) |
| Kiro CLI     | `~/.kiro/settings/mcp.json` — Kiro's own global MCP config, not shipped by any plugin, so the `jfrog` entry is **created or merged in** with a placeholder url, then substituted like every other row above |

The Kiro CLI merge is additive and never destructive: the file normally
holds the user's other MCP servers, so a `jfrog` entry that already has a
url is left untouched (a placeholder in it is the substitution step's
job), other servers and the file's mode are preserved, a symlinked config
stays a symlink, and a file that isn't valid JSON is reported rather than
rewritten.

Harness detection (in priority order): `CODEX_SANDBOX` / `CLAUDECODE` /
`CURSOR_TRACE_ID` / `VSCODE_PID` / `TERM_PROGRAM`. Override with
`JFROG_INIT_HARNESS=claude|cursor|vscode|codex|kiro|kiro-cli` or a
specific file via `JFROG_INIT_MCP_CONFIG=/abs/path`. Neither Kiro target
has an auto-detect signal yet — both are reachable only via the
`JFROG_INIT_HARNESS=kiro` / `kiro-cli` overrides.

`SKILL.md`'s Step 5 already has you export `JFROG_INIT_HARNESS=kiro` /
`kiro-cli` up front when you're running as one of those two — before
the detector ever runs, so Exit 3 below isn't the trigger for it.

**What the detector verifies** (three things):

1. Plugin file exists and is non-empty at its harness-specific path.
2. Parses as valid JSON.
3. Contains a `jfrog` entry (nested under `mcpServers` on every harness
   but Codex, which has no wrapper) with a non-empty `url`.

It does NOT enforce any other `type`/`url` shape (each plugin owns its
own schema) and it does NOT probe the endpoint — a mis-configured MCP
endpoint surfaces immediately the first time the user invokes it, and
the walk's other network checks (Steps 4, 7) already prove the JPD is
reachable.

**Step 5 branches, required behavior:**

- **Exit 0 (green)** → proceed to Step 6.
- **Exit 1 (red)** or **Exit 3 (error)** → **non-blocking** — proceed
  to Step 6 as if green, but remember the cause for the Final Summary.
  Steps 6 and 7 call the JPD's REST APIs directly with `jf config`
  credentials, never through the JFrog MCP, so a broken or
  missing plugin `mcp.json` doesn't affect whether those checks are
  accurate — there's nothing to gain by stopping the walk over it.
  Tell the red causes apart from the detector's `detail` for the
  Final Summary note:
  - Plugin file missing / empty / lacks a valid `jfrog` entry. Fix:
    **reinstall or update the JFrog plugin.** If the user asks why or
    how to fix it, run:

    ```bash
    node "${CLAUDE_SKILL_DIR}/scripts/jfrog-reinstall-jfrog-plugin.mjs"; true
    ```

    and relay its per-harness remedy — it only diagnoses and prints,
    never writes to the plugin's mcp.json.
  - Plugin file has a placeholder and automatic substitution failed
    with no url set for the resolved server-id. Fix: **resolve `jf
    config`**. Reinstalling the plugin does not fix this.
  - Kiro CLI only: it could not create or update its own
    `~/.kiro/settings/mcp.json` — no plugin ships this file, so there's
    nothing to reinstall. The detail names the actual cause (e.g. the
    parent path blocked by a non-directory, or a permissions error).
    Fix: **correct the file or parent-directory permissions/path**,
    then re-run.
  - (Exit 3 only) Harness could not be detected, or plugin file is
    invalid JSON / unreadable. Show the raw detector error in the note.
    **Do not react to this by guessing a harness or trying
    `JFROG_INIT_HARNESS` values to see what resolves it.** If this is
    Kiro or Kiro CLI, the override was already exported before the
    detector's first run (top of Step 5), so it should not reach Exit
    3 for that cause at all. Otherwise this is Exit 3, non-blocking
    like every other cause above: note it and move on to Step 6 in the
    same turn, with zero visible pause — do not stop to read this file
    or any other reference doc over it.
- **Exit 2 (`ask`)** → the one outcome that still blocks: placeholder
  present, but the jf server-id is ambiguous — every step from here on
  needs a resolved server-id, so there's nothing to skip ahead to.
  **Stop and read `references/server-picker.md` in full**, then
  re-invoke with the pick as the positional argument.

**Note on Claude Code**: today the released Claude JFrog plugin does
not include a `.mcp.json` in its shipped tree, so Step 5 goes red on
Claude Code until the plugin ships one — this no longer stops the
walk, but the Final Summary still notes it. Never fall back to
project-scope `.mcp.json`.
