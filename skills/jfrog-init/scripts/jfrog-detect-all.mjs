#!/usr/bin/env node
// Runs the detectors in dependency order and reports one JSON summary line.
// Idempotent, read-only, zero mutation (aside from the state-file hint on
// green) — safe to run repeatedly.
//
// Usage: node jfrog-detect-all.mjs [server-id] [project-input]
//
// `project-input` is a name-or-key string — jfrog-detect-project.mjs resolves it
// to a canonical key against the enumerated project list, then validates.
//
// Order (linear; stop at first non-green, non-"ask"):
//   1. Node.js >= 18       -> inline (running this .mjs file already
//      proves Node exists; only the version and `npx` need checking)
//   2. jf CLI installed    -> jfrog-detect-jf-cli.mjs
//   3. jf server configured -> jfrog-detect-jf-config.mjs
//   4. server reachable     -> jfrog-detect-server-ping.mjs <server-id>
//   5. jfrog MCP            -> jfrog-detect-jfrog-mcp.mjs
//   6. project resolved     -> jfrog-detect-project.mjs
//   7. AI Catalog + entitled -> jfrog-detect-catalog-runtime.mjs <server-id>
//
// Step 6 does NOT read JF_PROJECT and does NOT export anything. The
// picked project input is passed as the 2nd positional argument and
// threaded forward. On green, this script writes a hint to
// ~/.jfrog/setup.json so subsequent walks can offer "reuse the current
// project" — the file only stores public identifiers (server ID, JPD
// URL, canonical project key), never secrets, never a timestamp.
//
// Step 7 going red — exit 1 (catalog not hosted at this JPD / unreachable
// / 5xx) OR exit 4 (reachable but not entitled) — is NON-BLOCKING: Steps
// 1-4 are what "green" means here, and both catalog outcomes
// are reported separately via `catalogEntitled` (and `catalogReason`
// when false) in the final summary line, so a user with no AI Catalog on
// this JPD, or no entitlement to it, still gets a completed, usable
// setup instead of a dead-end red result over a feature this skill's
// core prerequisites (Steps 1-4) don't depend on.
//
// Step 5 (jfrog MCP) going red or erroring is ALSO non-blocking, for
// the same reason: Steps 6 and 7 call the JPD's REST APIs directly
// with credentials from `jf config`, never through `mcpServers.jfrog`,
// so a broken/missing plugin mcp.json doesn't affect whether those
// checks are accurate. Reported separately via `mcpConfigured`. An
// ambiguous server-id (exit 2, "ask") is the one Step 5 outcome that
// still blocks — every step from here on needs a resolved server-id,
// so there's nothing to skip ahead to.
//
// Step 6 (project) going red (no match / not entitled / ambiguous
// match — exit 1 only) is ALSO non-blocking here — this script makes
// exactly one resolution attempt per invocation; the interactive walk
// (SKILL.md) is what re-asks the user for a different project, capped at
// one retry so it can't loop forever. Whether this is the user's first
// attempt or their last, this script itself has no way to tell the
// difference, so it always reports the gap rather than blocking, via
// `projectResolved`. Exit 3 (jf missing, credentials rejected, or an
// unexpected response shape) is a genuine error, NOT covered by this
// non-blocking treatment — same as Step 5's own exit 2, it still sets
// `overall = 1`. The state-file write still happens (server + JPD
// URL known is reason enough to remember them) — it's passed an empty
// project key, and jfrog-state-file.mjs keeps whatever project was
// already on record rather than erasing it. An ambiguous server-id
// (exit 2, "ask") still blocks, same reasoning as Step 5.
//
// Exit 0 -> Steps 1-4 green (see catalogEntitled / mcpConfigured /
//           projectResolved for the three non-blocking gaps)
// Exit 1 -> a check failed / went red / requires action

import { emit, jfAvailable, jfConfigShow, urlForServer, normalizeJpdUrl } from "./lib/jf.mjs";
import { commandExists } from "./lib/command.mjs";
import { resolveJfServer } from "./jfrog-resolve-jf-server.mjs";
import { detectJfCli } from "./jfrog-detect-jf-cli.mjs";
import { detectJfConfig } from "./jfrog-detect-jf-config.mjs";
import { detectServerPing } from "./jfrog-detect-server-ping.mjs";
import { detectJfrogMcp } from "./jfrog-detect-jfrog-mcp.mjs";
import { detectProject } from "./jfrog-detect-project.mjs";
import { detectCatalogRuntime } from "./jfrog-detect-catalog-runtime.mjs";
import { setStateForServer } from "./jfrog-state-file.mjs";

const SERVER_ID = process.argv[2] || "";
const PROJECT_KEY = process.argv[3] || "";

// Step 1 has no script to shell out to (see Step 1 in SKILL.md) — running
// this file already proves Node exists, so only the version and `npx`
// need checking.
function checkNode() {
  const major = parseInt(process.versions.node, 10);
  if (major < 18) {
    emit({ check: "node", status: "red", detail: `Node.js v${process.versions.node} is too old — jfrog-init requires Node >= 18.` });
    return 1;
  }
  if (!commandExists("npx")) {
    emit({ check: "node", status: "red", detail: "npx not on PATH — Node.js install is broken." });
    return 1;
  }
  emit({ check: "node", status: "green", detail: `Node.js v${process.versions.node}` });
  return 0;
}

let overall = 0;

if (checkNode() !== 0) overall = 1;
if (overall === 0 && detectJfCli() !== 0) overall = 1;
if (overall === 0 && detectJfConfig() !== 0) overall = 1;
if (overall === 0 && (await detectServerPing(SERVER_ID)) !== 0) overall = 1;

// Captured here, before Steps 5-7 can flip `overall` for their own
// blocking sub-cases (ambiguous server-id, no project input, jf missing —
// see each step's comment below) — the state-file write further down
// keys off THIS flag, not the final `overall`, per batch-walk.md: the
// write happens whenever Steps 1-4 are green, regardless of the
// mcpConfigured/projectResolved/catalogEntitled gaps Steps 5-7 report.
const steps1To4Passed = overall === 0;

let mcpConfigured = true;
if (overall === 0) {
  const mcpCode = detectJfrogMcp(SERVER_ID);
  if (mcpCode === 2) {
    // Ambiguous server-id — not a Step 5 failure, a prerequisite every
    // later step also needs; nothing to skip ahead to.
    overall = 1;
  } else if (mcpCode !== 0) {
    mcpConfigured = false;
  }
}

let projectResult = null;
// Defaults to false, not true — Step 6 not having run yet (or having
// errored/asked rather than resolved) must never be read as "resolved".
// A default of true here previously meant that if Step 6 hit exit 2 or 3
// below, `projectResolved` stayed at its initial value instead of being
// set false, so the write section further down (before this fix, gated
// on the same `overall === 0` this block also guards) could fall back to
// PROJECT_KEY — the caller's raw, unvalidated input — for a project Step
// 6 never actually validated.
let projectResolved = false;
if (overall === 0) {
  projectResult = await detectProject(SERVER_ID, PROJECT_KEY);
  if (projectResult.exitCode === 2 || projectResult.exitCode === 3) {
    // Exit 2 (ask): no input passed, or the server-id itself is
    // ambiguous — nothing to report a gap about yet, the caller just
    // needs to provide one. Exit 3 (error): jf missing, credentials
    // rejected, or an unexpected response shape — a genuine failure, NOT
    // subject to the retry cap (see SKILL.md Step 6 / flow-diagram.md's
    // STOPCREDS), so it must block same as any other real error, not
    // silently collapse into "no project resolved yet".
    overall = 1;
  } else if (projectResult.exitCode === 0) {
    projectResolved = true;
  }
  // Exit 1 (red: ambiguous match, 404, 403) is the retryable, non-blocking
  // gap — projectResolved stays false, same as the initial default.
}

let catalogEntitled = true;
let catalogReason;
if (overall === 0) {
  const catalogCode = await detectCatalogRuntime(SERVER_ID);
  if (catalogCode === 4) {
    // Reachable but not entitled — a permissions gap for the user's
    // admin to fix, not a broken setup; doesn't block the walk.
    catalogEntitled = false;
    catalogReason = "not_entitled";
  } else if (catalogCode === 1) {
    // Not hosted at this JPD / unreachable / 5xx — same non-blocking
    // treatment as "not entitled": Steps 1-4 are this skill's core
    // prerequisites, and the AI Catalog being absent or unreachable says
    // nothing about whether those actually work. Distinguished from
    // "not_entitled" via `catalogReason` so the caller can phrase the
    // final summary accurately instead of always saying "not entitled".
    catalogEntitled = false;
    catalogReason = "unreachable";
  } else if (catalogCode !== 0) {
    // Exit 2 (ask: ambiguous server-id) and exit 3 (error: jf missing,
    // credentials rejected, unexpected response shape) are genuine
    // stops, not subject to this non-blocking treatment.
    overall = 1;
  }
}

// Gated on steps1To4Passed, not the final `overall` — a Step 5/6/7
// blocking sub-case (ambiguous server-id, no project input, jf missing)
// can flip `overall` to 1 without undoing the fact that Steps 1-4 already
// passed, and the server + JPD URL are worth remembering on their own
// regardless (see batch-walk.md and SKILL.md's Final Summary section).
if (steps1To4Passed) {
  if (jfAvailable()) {
    const configList = jfConfigShow();
    const resolvedServerId = resolveJfServer(SERVER_ID, configList);
    const resolvedJpdUrl = normalizeJpdUrl(urlForServer(configList, resolvedServerId));

    // Only pass a project key that was actually validated to the state
    // file — PROJECT_KEY itself can be non-empty (the caller's raw,
    // unvalidated input) even when projectResolved is false; passing ""
    // in that case tells jfrog-state-file.mjs to leave any previously
    // recorded project alone rather than overwrite it with an unverified
    // value.
    let resolvedProjectKey = "";
    if (projectResolved) {
      resolvedProjectKey = projectResult?.resolvedKey || PROJECT_KEY;
    }

    if (resolvedServerId && resolvedJpdUrl) {
      // Best-effort: the state file is a "reuse last project?" hint, not a
      // source of truth (see jfrog-state-file.mjs) — a write failure here
      // doesn't undo the fact that Steps 1-4 above passed, so it's
      // surfaced as a warning rather than flipping the summary to red.
      // Written even when resolvedProjectKey is "" (project not resolved
      // this walk) — jfrog-state-file.mjs then keeps whatever project was
      // already on record instead of erasing it, and callers can always
      // tell a project is missing here from `projectResolved` above.
      const stateResult = setStateForServer(resolvedServerId, resolvedJpdUrl, resolvedProjectKey);
      if (!stateResult.ok) {
        console.error(`warning: failed to save setup state (${stateResult.error}) — next walk won't offer to reuse this project`);
      }
    }
  }
}

if (overall === 0) {
  console.log(
    JSON.stringify({
      summary: "green",
      catalogEntitled,
      ...(catalogReason ? { catalogReason } : {}),
      mcpConfigured,
      projectResolved,
    })
  );
} else {
  console.log(JSON.stringify({ summary: "red" }));
}

// Sets process.exitCode rather than calling process.exit() — same reason
// every detector this file imports does: a forced exit can truncate the
// summary line's stdout write if it's still draining through a pipe, and
// this line is the one thing a caller of this script actually reads.
process.exitCode = overall;
