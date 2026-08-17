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

Because we have that URL sitting in `jf config`, and because leaving
the placeholder in place means the MCP silently fails to load in the
IDE / agent, Step 5 auto-substitutes it. If the detector finds the
placeholder pattern anywhere in the file, it calls
`jfrog-substitute-mcp-placeholders.mjs`, which:

1. Parses the file as JSON and looks **only** at
   `mcpServers.jfrog.url` — never a file-wide text replace, so an
   unrelated MCP server entry or JSON value that happens to contain the
   same placeholder text is never touched.
2. Reads the JPD URL from `jf config` (default server, or the one
   passed as arg 2), normalizes it to the JPD root, and substitutes it
   into that one `url` string.
3. Handles both the `https://${...}` form (where our own scheme would
   double up) and the bare `${...}` form.
4. Re-serializes the whole file (`JSON.stringify(parsed, null, 2)`) and
   writes atomically (temp file + rename) so a partial write cannot
   corrupt the file. Original formatting/whitespace elsewhere in the
   file is not preserved byte-for-byte.
5. Is idempotent — subsequent runs find no placeholder and no-op.

This is the ONLY place `/jfrog-init` writes to the plugin-owned
`mcp.json`. Everything else in Step 5 is read-only.

**Per-harness plugin-owned config file:**

| Harness      | Plugin-owned config file |
|--------------|--------------------------|
| Cursor       | `~/.cursor/plugins/cache/cursor-public/jfrog/<sha>/mcp.json` (glob → newest) |
| VS Code      | `~/.vscode/agent-plugins/github.com/jfrog/vscode-plugin/plugin/.mcp.json` |
| Claude Code  | `~/.claude/plugins/cache/<marketplace>/jfrog/<version>/.mcp.json` (glob) |

Harness detection: `CLAUDECODE` / `CURSOR_TRACE_ID` / `VSCODE_PID` /
`TERM_PROGRAM`. Override with `JFROG_INIT_HARNESS=claude|cursor|vscode`
or a specific file via `JFROG_INIT_MCP_CONFIG=/abs/path`.

**What the detector verifies** (three things):

1. Plugin file exists and is non-empty at its harness-specific path.
2. Parses as valid JSON.
3. Contains an `mcpServers.jfrog` entry with a non-empty `url`.

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
  credentials, never through `mcpServers.jfrog`, so a broken or
  missing plugin `mcp.json` doesn't affect whether those checks are
  accurate — there's nothing to gain by stopping the walk over it.
  Tell the two red causes apart from the detector's `detail` for the
  Final Summary note:
  - Plugin file missing / empty / lacks `mcpServers.jfrog`. Fix:
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
  - (Exit 3 only) Harness could not be detected, or plugin file is
    invalid JSON / unreadable. Show the raw detector error in the note.
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
