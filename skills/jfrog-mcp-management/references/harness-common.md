# Harness config — common + routing

Reference for the Install, List, and Remove flows of the
`jfrog-mcp-management` skill.

The Agent Guard workflow is identical on every harness. The parts that vary —
config file path, top-level JSON key, env/secret reference syntax, and
enable/restart/verify — are split into **one file per harness**. Read this file
plus **exactly one** harness file; do NOT open the others.

## Step A — detect the harness and open ONE file

Detect from the environment (the `CLAUDECODE`/`CURSOR_*` signals below mirror
`../../jfrog/scripts/check-environment.sh` `detect_harness()`; the
`TERM_PROGRAM=vscode` editor hint is not in that script), then read only the
matching harness file. **Evaluate the rows top-to-bottom and take the FIRST
match** — order matters: Cursor is a VS Code fork and also sets
`TERM_PROGRAM=vscode`, so the Cursor row (checked first, on `CURSOR_*`) must win
before the VS Code `TERM_PROGRAM` row is considered. The VS Code harness file
targets the **VS Code editor** (Copilot MCP support), not the standalone GitHub
Copilot terminal CLI — the CLI (`COPILOT_CLI`) has no editor UI or `mcp.json`,
so it falls through to the Fallback section. If detection is not conclusive, ASK
the user which agent/editor they are in — do not guess, and do not read multiple
harness files.

| Detected harness | Env signals | Read THIS file (and no other harness file) |
| --- | --- | --- |
| Claude Code | `CLAUDECODE` or `CLAUDE_CODE_ENTRYPOINT` | [harness-claude.md](harness-claude.md) |
| Cursor | `CURSOR_AGENT` / `CURSOR_CLI` / `CURSOR_TRACE_ID` | [harness-cursor.md](harness-cursor.md) |
| VS Code editor | editor is VS Code (`TERM_PROGRAM=vscode`) **and no `CURSOR_*` var is set** | [harness-vscode.md](harness-vscode.md) |
| anything else | none of the above | **Fallback** section below — no harness file exists |

Once you know your harness, use ONLY these fields from its file: `Config files`
(path + scope), `Top-level key`, `Value reference` (env/secret syntax), `Enable`,
`Restart`, `List installed`, `Verify`. Every step in SKILL.md that says "per
harness-config" means: use the value from your one harness file.

## Common — identical on every harness

These do not vary; the harness file only overrides the pieces above.

**The Agent Guard entry** is always a stdio server invoking
`npx @jfrog/agent-guard`. `command`, `args` (and their order), and `_JF_ARGS`
are the same everywhere — only the wrapping top-level key and the value-reference
syntax come from your harness file.

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
