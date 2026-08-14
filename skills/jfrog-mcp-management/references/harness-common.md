# Harness config — common + routing

Reference for the Install, List, and Remove flows of the
`jfrog-mcp-management` skill.

The Agent Guard workflow is identical on every harness. The parts that vary —
config file path, top-level JSON key, env/secret reference syntax, and
enable/restart/verify — are split into **one file per harness**. Read this file
plus **exactly one** harness file; do NOT open the others.

## Step A — detect the harness and open ONE file

The `CLAUDECODE` / `CURSOR_*` / `CODEX_*` / `OPENCODE` signals below
mirror `../../jfrog/scripts/check-environment.sh` `detect_harness()`; the
`TERM_PROGRAM=vscode` editor hint is **not** in that script, and Devin is
**not** detected by the script. Each row's signal is **self-contained and
non-overlapping**, so detection does not depend on evaluation order. The VS
Code harness file targets the **VS Code editor** (Copilot MCP support), not
the standalone GitHub Copilot terminal CLI — the CLI (`COPILOT_CLI`) has no
editor UI or `mcp.json`, so it falls through to the Fallback section.

1. Call `../../jfrog/scripts/check-environment.sh` and parse `tool=<name>` from
   the User-Agent line. When `tool` is `claude` or `cursor`, that matches the
   Claude or Cursor row below — open that harness file. This call also
   satisfies the Prerequisites environment check — capture/export
   `JFROG_CLI_USER_AGENT` from it here too, rather than calling the script
   again later.
2. Otherwise other `tool` values, `unknown`, or a missing `tool` are not enough
   — **match this table**. Use how your system prompt identifies you plus any
   environment variables that matching row lists. If row matches → open that file.
   Unsure → step 3. Sure none apply → Fallback.
3. If detection is still not conclusive, ASK the user which agent/editor they
   are in — do not guess, and do not read multiple harness files.

| Detected harness | Signal (self-contained) | Read THIS file (and no other harness file) |
| --- | --- | --- |
| Claude Code | `CLAUDECODE` or `CLAUDE_CODE_ENTRYPOINT` env var | [harness-claude.md](harness-claude.md) |
| Codex | `CODEX_SANDBOX` / `CODEX_THREAD_ID` / `CODEX_CI` | [harness-codex.md](harness-codex.md) |
| Cursor | `CURSOR_AGENT` / `CURSOR_CLI` / `CURSOR_TRACE_ID` env var | [harness-cursor.md](harness-cursor.md) |
| OpenCode | `OPENCODE` | [harness-opencode.md](harness-opencode.md) |
| Devin Desktop | Your system prompt / system instructions identify you as **Devin** (Devin Desktop / Devin Local / Cognition). That alone is enough. Optionally confirm with `VSCODE_IPC_HOOK` set to the Devin Desktop IPC socket (full path), e.g. macOS: `~/Library/Application Support/Devin/<version>-main.sock` — the expanded path contains `/Devin/`. The path alone is **not** enough. | [harness-devin.md](harness-devin.md) |
| VS Code editor | `TERM_PROGRAM=vscode` **and no `CURSOR_*` var is set** **and no `OPENCODE` var is set** **and no `CODEX_*` var is set** **and no `CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT` var is set** **and no `GEMINI_CLI` / `GOOSE_TERMINAL` / `COPILOT_CLI` var is set** **and** your system prompt / system instructions do **not** identify you as Devin | [harness-vscode.md](harness-vscode.md) |
| anything else | none of the above | **Fallback** section below — no harness file exists |

Once you know your harness, use ONLY these fields from its file: `Config files`
(path + scope), `Top-level key`, `Value reference` (env/secret syntax), `Enable`,
`Restart`, `List installed`, `Verify`. Every step in SKILL.md that says "per
harness-config" means: use the value from your one harness file.

## Common — identical on every harness

These do not vary; the harness file only overrides the pieces above.

**The Agent Guard entry** always invokes `npx @jfrog/agent-guard` with the same
argument tokens (in the same order) and the same `_JF_ARGS`. What varies per
harness is **how the entry is written** — the wrapping top-level key, the
value-reference syntax, and the entry *shape* itself (the transport field, and
whether `command`/`args` are separate). The JSON template below is the common
case; harnesses whose config is not JSON differ — e.g. **Codex** uses TOML with no
`type`, and **OpenCode** merges `command`+`args` into a single `command` array — so
**always follow your harness file's "Full entry shape" when it has one.**

```json
{
  "<TOP_LEVEL_KEY from harness file>": {
    "<spec.packageName>": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "--yes",
        "--registry",
        "<REGISTRY_URL>",
        "@jfrog/agent-guard",
        "--server",
        "<SERVER_ID>"
      ],
      "env": {
        "_JF_ARGS": "project=<JFROG_PROJECT_KEY>&mcp=<spec.packageName>",
        "<ENV_VAR_OR_HEADER_NAME>": "<value reference from harness file>"
      }
    }
  }
}
```

- `"type": "stdio"` always — never `"http"`, `"sse"`, or a top-level `"url"`
  (those bypass the Agent Guard).
- `--yes` and `--registry <URL>` MUST precede `@jfrog/agent-guard` in `args`.
- `--server <ID>` in `args` is conditional: drop both array elements only on the
  `JFROG_URL`+token env path (see [agent-guard-common.md](agent-guard-common.md)).
- Never write a raw secret — always a value reference in the harness's syntax.
- `_JF_ARGS` values are substituted raw (no URL-encoding), which is safe only
  because both are free of query-string reserved chars (`&`, `=`, `+`, space): a
  JFrog project key is lowercase alphanumerics/hyphens, and `spec.packageName`
  adds only `@ . /`. Never substitute any other value into `_JF_ARGS`.

**Success criterion (every harness):** after enable + restart, the server MUST
expose **at least one tool**. A "connected" / "running" label alone is NOT proof
— the Agent Guard proxy can report up with 0 upstream tools. An empty
tool/capability list = Failed.

**OAuth cache (every harness):** OAuth `--login` caches tokens in
`~/.jfrog/jfrogmcp.conf.json` regardless of harness; removal cleanup of that
file is the same everywhere (see SKILL.md Remove).

## Fallback — harness not listed

No harness file exists for this agent. Do NOT reuse another harness's path, key,
or reference syntax. Instead:

1. Find, from the harness's own documentation, its MCP config file location, the
   top-level key of its servers map, and how it references env/secret values.
2. Write the common Agent Guard entry above under that key, with that syntax.
3. Enable, restart, and verify per that harness's own mechanism; confirm ≥1 tool
   before reporting success.

If you cannot determine the config location, ASK the user — writing to the wrong
file is worse than asking.
