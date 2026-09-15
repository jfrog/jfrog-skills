# Step 6 — resolve branches

**Required behavior for Step 6, not optional background.** Read this in
full whenever `jfrog-detect-project.mjs` returns anything other than a
clean exit 0.

**Everything below — exit codes, `unresolved`, and which bullet you
land on — is reasoning for you to follow silently, never to narrate.**
Never repeat this table's own words back to the user (e.g. "Exit 2,
no `unresolved`" or "this is an ask with no input"). The only output
the user sees is the resulting prompt itself, the raw detector error
where one is shown, or the Final Summary.

- **Exit 2 (`ask`) with `"unresolved": "server"`** → not a project ask
  — the server-id is ambiguous. Follow "Resolving `<server-id>` for
  Steps 4-7" in `SKILL.md` (prompt for a server from `candidates`), then
  re-invoke Step 6 with the picked server-id as arg 1.
- **No input passed (`ask`/`error`, no `unresolved`)** → enumeration
  (`GET /access/api/v1/projects`) runs to drive the picker, and this is
  the only remaining way Step 6 can fail to resolve a project:
  - **Exit 2 (`ask`)** → use the picker/free-form ask from
    `references/project-picker.md`, then re-invoke with the picked
    value as arg 2. Whatever the user picks or types is then accepted
    verbatim by the Exit 0 branch below — no second round-trip through
    matching.
  - **Exit 3 (error)** → `jf` missing or credentials unavailable/
    rejected (needed to authenticate the enumeration call). Show the
    raw detector error — this is a genuine stop (no re-pick can fix bad
    credentials).
- **Input passed (resolve — no matching, no validation)** → accepted
  exactly as given, with no network call at all: no per-project
  existence/access probe (GetProject requires Platform/Project Admin,
  same as the enumeration call — a non-admin caller would just get 403
  from both and never learn whether the project is real), and no
  name-or-key matching against the enumerated list either (that also
  depended on enumeration succeeding, and could only ever flag two
  enumerated projects as ambiguous — never useful to the same
  non-admin accounts this exists for). There is no ambiguous (red)
  outcome any more; a typed input is always green.
  - **Exit 0 (green)** → the input is accepted verbatim; `resolvedKey`
    is exactly what was passed, and the detail line says
    existence/access was not verified. Proceed to Step 7
    (`jfrog-detect-catalog-runtime.mjs [server-id]`), which takes no
    project argument — the input string only needs to be kept around
    as arg 2 to `jfrog-detect-all.mjs` itself, so a re-run re-resolves
    Step 6 the same way.
