# Preserving command output

> **Tier B MUST** before advanced CLI/API I/O. Not domain on-demand; not every CLI / setup.

When a CLI command or API call returns data, redirect output to a temp file so
you can re-read it without re-executing the call:

```bash
OUT=/tmp/jf-repos-$$.json
jf api /artifactory/api/repositories > "$OUT"
echo "$OUT"
```

Use `$$` (the shell PID) in the filename to prevent collisions across
concurrent sessions or processes.

**Cross-call gotcha:** each Shell tool invocation runs in a new process with a
different PID, so `$$` expands to a different value in each call. Always
**echo the expanded filename** so the agent can read it from the output and
reuse the literal path in subsequent calls. Three patterns, in priority order:

1. **`$$` + echo** (preferred): use `$$` for collision safety, echo the path
   as shown above. The agent reads `/tmp/jf-repos-12345.json` from the output
   and passes that literal value to the next Shell call.
2. **Session ID**: when many files share a prefix across calls, generate an ID
   once (`SID=$(date +%s)-$$`), echo it, and reuse in later calls.
3. **Hardcoded names**: last resort — risks collisions when parallel calls or
   subagents write to the same path.

This protects against wasted round-trips when you need to retry parsing — for
example, if a `jq` filter fails or you extract the wrong field on the first
attempt. Re-read the file instead of hitting the server again.

Do **not** duplicate the same **network** request in a shell pipeline (e.g. with
`||`) only to re-run `jq` or to reveal jq diagnostics—the duplicate call
adds load on JFrog without fetching new data. Run
`jq '<filter>' /tmp/jf-*-$$.json` (or redirect stdin from the file) instead
of re-running the same `jf api` or other identical network-backed command.

Do **not** reuse saved output across unrelated steps or changed contexts (different
server, user, or intent). The file is only valid for the immediate sequence of
operations that motivated the original call.
