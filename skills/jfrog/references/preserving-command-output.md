# Preserving command output

> **Tier B MUST** before advanced CLI/API I/O. Not domain on-demand; not every CLI / setup.

When a CLI command or API call returns data, redirect output to a temp file so
you can re-read it without re-executing the call:

**Once per session**, create a private temp dir (`mktemp -d`: mode 0700,
unpredictable name) and echo it:

```bash
JF_TMP=$(mktemp -d) && echo "$JF_TMP"
```

Then write every response inside it (`${JF_TMP:?}` aborts if unset, else the
path would start at `/`):

```bash
JF_TMP=<dir echoed above>
jf api /artifactory/api/repositories > "${JF_TMP:?}/repos.json"
```

**Cross-call gotcha:** each Shell call is a new process; variables do not
survive. Set `JF_TMP` to the **echoed** literal at the start of every later
call, with a distinct file name per call.

**Never** write to fixed or PID-based (`$$`) names directly in shared `/tmp` —
other local users can read or pre-create them.
Only the creator removes the dir (`rm -rf "${JF_TMP:?}"`) when the whole task
is done; subagents writing into it never delete it. After cleanup, run
`mktemp -d` again — never recreate the old path. Subagent file names get an
index prefix (`subagent-2-users.json`).

This avoids wasted round-trips when retrying parsing (a failed `jq` filter,
wrong field): re-read the file instead of hitting the server again.

Do **not** repeat the same **network** request (e.g. via `||`) only to re-run
`jq` or reveal jq diagnostics — it adds load on JFrog without new data. Run
`jq '<filter>' "${JF_TMP:?}/<file>.json"` on the saved file instead.

Do **not** reuse saved output across unrelated steps or changed contexts
(server, user, intent); it is valid only for the sequence that motivated the
original call.
