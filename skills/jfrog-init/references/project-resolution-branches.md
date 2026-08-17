# Step 6 — resolve/validate branches

**Required behavior for Step 6, not optional background.** Read this in
full whenever `jfrog-detect-project.mjs` returns anything other than a
clean exit 0.

- **Exit 2 (`ask`) with `"unresolved": "server"`** → not a project ask
  — the server-id is ambiguous. Follow "Resolving `<server-id>` for
  Steps 4-7" in `SKILL.md` (prompt for a server from `candidates`), then
  re-invoke Step 6 with the picked server-id as arg 1.
- **No input passed (`ask`, exit 2, no `unresolved`)** → use the
  picker/free-form ask from `references/project-picker.md`, then
  re-invoke with the picked value as arg 2.
- **Input passed (resolve + validate)** →
  - **Exit 0 (green)** → project exists and is accessible; the
    canonical key is in the JSON `resolvedKey` field. Proceed to
    Step 7 (`jfrog-detect-catalog-runtime.mjs [server-id]`), which
    takes no project argument — the input string only needs to be
    kept around as arg 2 to `jfrog-detect-all.mjs` itself, so a
    re-run re-resolves Step 6 the same way.
  - **Exit 1 (red)** → ambiguous input, 404, or 403 — **cap re-asks at
    one retry within a single walk.** The first time any of these
    three happens, re-run the picker/free-form ask (`project-picker.md`);
    if the user's second attempt *also* comes back ambiguous/404/403,
    stop asking — proceed to Step 7 without a resolved project
    (non-blocking, same pattern as Step 5), and note it in the Final
    Summary instead of asking a third time. Never loop indefinitely on
    a silently-automatic retry the user didn't explicitly choose to
    continue (unlike Step 3's config picker, which loops on an
    explicit "did you finish?" the user opts into each time).
    - Ambiguous input → `candidates` lists the tied keys; re-run the
      picker/free-form ask (using the full `candidatesWithNames`, not
      just the tied subset).
    - HTTP 404 → project does not exist on this JPD; re-run the
      picker/free-form ask.
    - HTTP 403 → project exists but the user isn't entitled to this
      **specific** one — JFrog project ACLs are per-project, so this
      says nothing about any other project. Show the raw error, then
      re-run the picker/free-form ask (using `candidatesWithNames`,
      same as the 404 case) so the user can pick a different project
      instead of dead-ending; mention they can also ask their JFrog
      admin for access to the one they tried.
    - HTTP 5xx, or the probe could not connect at all → the JPD is
      erroring or unreachable right now. Re-picking won't help, so show
      the raw error and move on rather than re-running the picker; the
      Final Summary reports it via `projectResolved: false`. (Grouped
      with the retryable reds rather than with Exit 3 because it is a
      transient backend/network condition, not a broken setup — the
      same reason `jfrog-detect-catalog-runtime.mjs` calls its own
      "can't connect" red.)
  - **Exit 3 (error)** → `jf` missing, credentials unavailable/rejected
    (including HTTP 401 — this says nothing about whether the project
    exists), a 2xx response that wasn't shaped like the real GetProject
    endpoint, or an unexpected HTTP code. Show the raw detector error —
    this one is a genuine stop, not subject to the retry cap above (no
    re-pick can fix bad credentials).
