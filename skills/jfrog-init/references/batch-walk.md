# Running everything at once — jfrog-detect-all.mjs

`node scripts/jfrog-detect-all.mjs [server-id] [project-key]` runs Steps 1–7
in order and stops at the first non-green result — except Step 5 going
red/error, Step 6 going red (ambiguous/404/403), and Step 7 going red
in either of its two non-blocking shapes (exit 1: catalog not hosted /
unreachable / 5xx, or exit 4: reachable but not entitled), all of which
are non-blocking: Steps 1-4 passing is what "green" means here,
and the MCP-plugin, project-resolution, and catalog-availability gaps
are each reported as separate signals. This script makes exactly one
project-resolution attempt per invocation and has no way to tell a
first attempt from a last one, so it always treats a Step 6 red as
non-blocking — the interactive walk (see Step 6 in `SKILL.md`) is what
enforces the one-retry cap before giving up. Steps 5's, 6's, and 7's own
`ask`/`error` outcomes (ambiguous server-id, no project input passed,
`jf` missing/credentials rejected) still block, same as every other
step's genuine stop. If no project key is passed, Step 6 emits `ask`
with candidates and the walk halts; the caller re-invokes with the
picked project as arg 2 — unless that `ask` carries `"unresolved":
"server"`, in which case it's a server pick (see Step 6's branches) and
the re-invocation picks server-id (arg 1) instead.

Exit 0 = Steps 1-4 green (MCP configured or not, project resolved
or not, catalog entitled or not); exit 1 = something needs fixing. The
final JSON line adds `mcpConfigured: true|false`, `projectResolved:
true|false`, and `catalogEntitled: true|false` so a caller can tell the
exit-0 cases apart — plus `catalogReason: "unreachable" | "not_entitled"`
whenever `catalogEntitled` is `false`, so the Final Summary can name the
specific gap instead of a generic one. Writes the `~/.jfrog/setup.json`
state-file hint whenever Steps 1-4 are green, **regardless of
`projectResolved`, `mcpConfigured`, or `catalogEntitled`** — the server
and JPD URL are worth remembering on their own, independent of whether
a project got picked, the MCP plugin is wired up, or the AI Catalog is
reachable/the user is entitled to it. An unresolved project is passed
to `jfrog-state-file.mjs` as an empty key, which leaves any previously
recorded `currentActiveProject` alone rather than erasing it (see
`jfrog-state-file.mjs`); it's never written as a fresh, unvalidated
value.
