# Step 6 — project name-or-key resolution algorithm

Background for Step 6 of `/jfrog-init` (`SKILL.md`). The model doesn't
perform this matching itself — `jfrog-detect-project.mjs` does — but
this explains how a typed name-or-key resolves to a canonical project
key, for debugging an unexpected ambiguous-match or no-match result.

`jfrog-detect-project.mjs` resolves the input by:

1. Enumerating accessible projects via `GET /access/api/v1/projects`
   (GetProjectsList: <https://docs.jfrog.com/projects/reference/getprojectslist>
   — `fetch` with the token from `jf config export`; the endpoint lives
   on the Access service, off the Artifactory root, so `jf rt curl`
   cannot reach it; `jf api` is a possible future refactor). Cached per
   server for a few minutes (`scripts/lib/project-cache.mjs`) so
   re-invoking the detector for each user attempt in the picker doesn't
   re-hit the network every time — matching against the list is offline
   regardless.
2. Matching the input against `project_key` and `display_name`
   (`scripts/lib/projects.mjs`), strictest tier first — each tier only
   runs if the previous one had zero matches:
   - Exact key (case-insensitive) wins first.
   - Exact display-name (case-insensitive) wins next.
   - Exact match after stripping every non-alphanumeric character
     (`_`, `-`, spaces, ...) from both sides wins next — so `aicatalog`
     resolves against key `ai_catalog` / name `ai catalog` without the
     separator mattering. This is a fixed internal canonicalization,
     never a pattern compiled from user input.
   - Unique case-insensitive substring across keys+names wins next.
   - Unique substring after the same separator-stripping wins last —
     catches partial input that spans a separator, e.g. `aicat`
     against `ai_catalog`.
   - If more than one project matches at whichever tier first has any
     hits, the detector exits red with `candidates` listing the tied
     keys, and the model asks the user to be more specific.
3. Once resolved to a canonical key, existence is confirmed via
   `GET /access/api/v1/projects/<key>`.

The detector emits the canonical key on green in the JSON `resolvedKey`
field so the state-file writer can use it.
