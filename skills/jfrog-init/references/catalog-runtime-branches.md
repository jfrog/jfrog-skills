# Step 7 — AI Catalog reachable & entitled: mechanics and branches

Two sub-checks against
`<JPD>/ml/core/api/v1/mcp-registry/ml-projects?pageSize=1` (where
`<JPD>` is the URL stored in `jf config` for the resolved server —
this skill never uses a separate `JFROG_PLATFORM_URL` env var), both
must pass. This step is **purely about AI Catalog access** — no
runtime checks (Node lives in Step 1; `uv` / `docker` are per-MCP
concerns, not this skill's).

1. **Anonymous** GET — proves the endpoint is deployed at this JPD.
   `2xx/401/403/405/406` = up; `404` / connection failure = red.
2. **Authenticated** GET to the same path, with the bearer token (or
   user+password) extracted from `jf config export` — same credential
   source `jf` itself uses (token / user+password / SSO refresh,
   whatever's stored), so the skill never asks for or invents
   credentials, and the token only lives in memory for this one
   request. `2xx` = user is **entitled** to read the AI Catalog on
   this JPD; `403` = reachable but **not entitled**, non-blocking.
   `401` means the credentials themselves were rejected — that says
   nothing about entitlement, so it is treated as a blocking error
   instead (see Exit 3 below).

Splitting reachability from entitlement produces two distinct
outcomes: check 1 red = "this JPD doesn't host AI Catalog, or it's
unreachable right now"; check 2's `403` = "catalog is up but your
user isn't entitled." Neither is a setup failure — both are
non-blocking permissions/availability gaps the rest of the walk doesn't
depend on (see the exit-code branches below). Check 2's `401` is
different — it means `jf`'s own credentials are invalid or expired,
which is a genuine setup problem (Exit 3).

**Required branches:**

- **Exit 0 (green)** → done. All checks pass, including entitlement.
- **Exit 1 (red)** → anon probe 404 / connection failure / 5xx — the
  platform may not host AI Catalog, or it's unreachable right now.
  **Non-blocking** — same reasoning as Exit 4 below: Steps 1-4 are
  this skill's core prerequisites, and none of them depend on the AI
  Catalog being present. Proceed to the Final Summary, but append a
  note naming the gap (`catalogReason: "unreachable"` in
  `jfrog-detect-all.mjs`'s summary — see `batch-walk.md`).
- **Exit 2 (ask)** → multiple servers configured, none marked
  `isDefault`, no server-id passed. Same handling as Step 4's exit 2:
  **stop and read `references/server-picker.md` in full**, then
  re-invoke Step 7 with the pick as either the positional argument or
  `JF_SERVER_ID`.
- **Exit 3 (error)** → `jf` missing, the authed probe returned `401`
  (credentials themselves rejected — re-run `jf config add
  --interactive`), or an unexpected HTTP code (e.g. a broken `jf`
  config surfacing here instead of at Step 4). This is the one genuine
  stop this step has — a real error, not a "catalog isn't available"
  gap.
- **Exit 4 (not entitled)** → catalog is reachable but the authed probe
  returned `403`. **Non-blocking** — proceed to the Final Summary, but
  append the entitlement note (`catalogReason:
  "not_entitled"`). The detector's `detail` names the specific endpoint
  path (`/ml/core/api/v1/mcp-registry`) and the role the admin needs to
  grant (typically "AI Catalog Read" or "Application Admin"), so the
  user can forward an actionable request rather than a shrug.

Exit 1 and Exit 4 are deliberately handled the same way at the walk
level (see `batch-walk.md`) — both leave `catalogEntitled: false`, and
only differ in `catalogReason`, so the Final Summary can say "no AI
Catalog here" vs. "you're not entitled" accurately instead of collapsing
both into one generic gap.

**Never** grant a role or invent a project.
