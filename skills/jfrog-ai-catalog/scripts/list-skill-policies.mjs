#!/usr/bin/env node
// list-skill-policies.mjs — deterministic listing of the AI Catalog governance
// policies (project-scoped + Global, merged) that apply to skills in one
// project. Owns everything from here down: the query, auto-pagination,
// rendering, and scrubbing any internal service detail out of a failure —
// none of that is left to the calling agent.
//
// Node, not bash: this skill already hard-requires Node/npx for every other
// flow (`npx @jfrog/agent-guard`), so this adds no new prerequisite, and
// native JSON.parse + try/catch is inherently safer here than a jq/sed/awk
// shell pipeline (which is what this file replaced) for a malformed or
// truncated response.
//
// Usage:
//   node list-skill-policies.mjs --project <PROJECT> --server-id <SID>
//
// stdout (exit 0): finished text to present verbatim — either the intro line
//   plus markdown table (possibly with a trailing truncation note — still
//   part of the same verbatim block), or the one-line "no policies"
//   fallback. Never raw JSON; the caller does no parsing.
// stderr + exit 1: nothing usable could be produced at all (the very first
//   page failed, or the response was fundamentally unreadable). stderr is
//   one line, already safe to present verbatim — the internal service
//   name, its path, the query string, and any Trace ID are always scrubbed
//   before this script ever prints an error. Every failure path goes
//   through fail(), so scrubbing lives in exactly one place. A failure on
//   a LATER page, once at least one page already succeeded, is NOT
//   reported this way — see the pagination loop below.
// exit 2: usage error (missing --project/--server-id).
//
// Calls the AI Catalog policy engine by shelling out to `jf api`, on the
// JPD itself — never the browser-session gateway path — the same door the
// waiver flow already uses. Credentials stay entirely inside `jf`'s own
// resolved server config; this script never reads jfrog-cli.conf.v6 or any
// token itself.
//
// stdout/stderr + process.exit(): a synchronous process.exit() right after
// a write can truncate that same write, since stdout/stderr are not always
// flushed synchronously (pipes on POSIX, TTYs on Windows — the exact case
// when this script's output is captured by a calling agent). Every exit
// path therefore sets process.exitCode and unwinds via the DONE sentinel
// instead of calling process.exit() directly, mirroring the established
// pattern in skills/jfrog-mcp-management/scripts/jfrog-agent-guard-check.mjs
// (its GATE_DONE symbol) — this lets Node drain pending writes naturally.
//
// Windows / jf as a .cmd or .bat shim: deliberately NOT handled the way
// jfrog-agent-guard-check.mjs's runJf() does (needsShell + cmd.exe
// quoting). Checked directly: this repo's own canonical Windows install
// (skills/jfrog-init/scripts/jfrog-install-jf-cli.mjs) places a native
// jf.exe, never a .cmd/.bat wrapper, and the simpler, more directly
// comparable existing precedent for a plain `jf api`-style call
// (skills/jfrog/scripts/jfrog-check-server-collision.mjs) also spawns `jf`
// bare, with no shell handling at all. jfrog-agent-guard-check.mjs's extra
// defensiveness there is for its own reasons (an early, load-bearing
// security gate that must tolerate any install method); this script
// matches the simpler, already-working precedent instead.

import { spawnSync } from 'node:child_process';

const PAGE_LIMIT = 250;
// Bounded, not browsable: this answer must be complete, so pages are fetched
// silently up to a generous safety cap rather than asked about one at a
// time. If the cap is ever actually hit, that's flagged, not silently
// presented as the complete list.
const MAX_PAGES = 8;
// A soft aggregate budget across all paginated calls, independent of each
// call's own 30s timeout — checked only between pages (not sub-page), so it
// bounds fetches from STARTING rather than guaranteeing a hard ceiling: two
// pages just under the budget can still be followed by one more before the
// check next runs. Still meaningfully better than no aggregate bound at all
// (which would let MAX_PAGES sequential slow-but-not-hung calls compound to
// several minutes for what is framed as a quick lookup).
const OVERALL_BUDGET_MS = 60_000;

const DONE = Symbol('list-skill-policies:done');

function parseArgs(argv) {
  const args = { project: '', serverId: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') {
      args.project = argv[++i] ?? '';
    } else if (a === '--server-id') {
      args.serverId = argv[++i] ?? '';
    } else {
      process.stderr.write(`list-skill-policies.mjs: unknown argument: ${a}\n`);
      process.exitCode = 2;
      throw DONE;
    }
  }
  return args;
}

// httpStatus mirrors the more defensive of this repo's two existing
// jf-api-stderr parsers (skills/jfrog-mcp-management/scripts/
// jfrog-agent-guard-check.mjs's parseHttpStatus): both the "Http Status:
// NNN" line AND the "[Warn] ... returned NNN" line jf can print, scanning
// the WHOLE text with last-match-wins (a later line — e.g. a real failure
// after a retry's own status line — must not be shadowed by an earlier one).
function httpStatus(text) {
  let status = null;
  for (const line of String(text || '').split('\n')) {
    const http = line.match(/Http Status:\s*(\d+)/);
    if (http) {
      status = http[1];
      continue;
    }
    const returned = line.match(/\breturned\s+(\d{3})\b/);
    if (returned) status = returned[1];
  }
  return status;
}

// scrubServiceName replaces any mention of the internal service — a URL/path
// shape, or the plain-English name itself — with the customer-facing name.
// Used on BOTH the failure path (jf's stderr) and the success path (a rule's
// own name/description text is backend- or admin-authored and could
// legitimately contain the internal name; the guarantee in
// references/listing-policies.md is "never expose this," not "never expose
// this in errors").
function scrubServiceName(text) {
  return String(text || '')
    .replace(/https?:\/\/\S*\/unifiedpolicy\/\S*/g, 'the AI Catalog policy engine')
    .replace(/\/unifiedpolicy\/\S*/g, 'the AI Catalog policy engine')
    .replace(/unified[\s-]?policy/gi, 'AI Catalog policy engine');
}

// cleanErrorLine reduces jf's (possibly multi-line) stderr to one line safe
// to present verbatim: drop every line mentioning a Trace ID, take the last
// remaining non-empty line, then scrub it. Never throws — undefined/empty
// input yields ''.
function cleanErrorLine(stderrText) {
  const lines = (stderrText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.includes('Trace ID'));
  const last = lines.length ? lines[lines.length - 1] : '';
  return scrubServiceName(last);
}

// fail is the ONLY place that WRITES a runtime failure to stderr, so
// scrubbing lives in exactly one place. stderrText, if given, is jf's own
// stderr — used only to extract an HTTP status, never re-printed raw.
// Deliberately does not decide whether a failure is reportable at all —
// see PageFailure below for why fetchPage/the pagination loop never call
// this directly.
function fail(reason, stderrText) {
  const status = httpStatus(stderrText);
  const prefix = status
    ? `Listing AI Catalog policies failed (HTTP ${status}): `
    : 'Listing AI Catalog policies failed: ';
  process.stderr.write(prefix + reason + '\n');
  process.exitCode = 1;
  throw DONE;
}

// PageFailure carries a page-level failure WITHOUT writing anything yet.
// This matters: a failure on a later page, once earlier pages already
// succeeded, is meant to degrade gracefully into a truncated (but still
// reported as successful) result — if fetchPage's own checks called fail()
// directly, the stderr write and exitCode would already have happened
// before the pagination loop ever gets a chance to decide to recover,
// leaving a stray failure line on stderr alongside a "successful" table on
// stdout. Only the pagination loop, which knows whether recovery is
// possible, is allowed to turn this into an actual fail().
class PageFailure extends Error {
  constructor(reason, stderrText) {
    super(reason);
    this.reason = reason;
    this.stderrText = stderrText;
  }
}

// escapeCell makes a value safe as one markdown table cell: a literal `|`
// or embedded newline in a user-authored policy name (or a custom rule's
// name/description) would otherwise corrupt the table's row structure, and
// a literal backtick would break out of the inline-code span the Policy
// column wraps its value in. Also scrubs the internal service name — every
// cell goes through this, including the Scope column's "Other (<type>)"
// fallback, which splices in an unvalidated wire value like any other field
// here and must not be treated differently.
function escapeCell(value) {
  const s = value === undefined || value === null || value === '' ? '—' : String(value);
  return scrubServiceName(s)
    .replace(/\|/g, '\\|')
    .replace(/`/g, "'")
    .replace(/\r?\n/g, ' ');
}

// stripJfLogLines drops jf's own "[Info] ..." / "[Warn] ..." log lines from
// a stdout capture before parsing it as JSON — matching the same defensive
// pattern two other scripts in this repo already apply to `jf api` stdout
// (jfrog-agent-guard-check.mjs's jsonFromJfStdout, jfrog-login-
// save-credentials.mjs) for the same documented reason: these are supposed
// to go to stderr only, but a mix-up would otherwise turn an entirely valid
// response into a JSON.parse failure.
function stripJfLogLines(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !line.includes('[Info]') && !line.includes('[Warn]'))
    .join('\n')
    .trim();
}

function fetchPage(project, serverId, offset) {
  const path =
    '/unifiedpolicy/api/v1/policies' +
    `?action_type=use_skill&project_key=${encodeURIComponent(project)}` +
    `&hierarchical=true&expand=rules&limit=${PAGE_LIMIT}&offset=${offset}`;

  // Flags before the path, matching this repo's documented jf api
  // convention (skills/jfrog/SKILL.md) and the real precedent in
  // jfrog-agent-guard-check.mjs's runJfApi — not just a style match: a past
  // jf CLI (2.120+) parser regression treated a flag placed AFTER the path
  // as an extra positional argument for at least one other flag on this
  // call (see jfrog-login-register-session.sh), so this order is the
  // established, defended convention, not an arbitrary choice.
  const result = spawnSync(
    'jf',
    ['api', '--server-id', serverId, path],
    {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  if (result.error) {
    // spawn itself failed (e.g. `jf` not found on PATH) — result.stderr is
    // empty in this case, so there is nothing to scrub. Verified directly
    // (node -e against a spawnSync that hits its timeout): the exceeded
    // timeout sets result.error.code to 'ETIMEDOUT' and result.signal to
    // 'SIGTERM'; spawnSync (unlike execFileSync/execSync) never sets a
    // `killed` property at all — do not check for one.
    if (result.error.code === 'ETIMEDOUT') {
      throw new PageFailure('the AI Catalog policy engine took too long to respond');
    }
    throw new PageFailure('could not run the jf CLI');
  }
  if (result.signal) {
    // A signal without result.error (belt-and-braces for other Node/OS
    // combinations) is reported factually, not attributed to a specific
    // cause this script cannot actually confirm (a user-sent SIGINT and an
    // OS OOM-kill both land here too, and are not "did not respond").
    throw new PageFailure(
      `the AI Catalog policy engine call was interrupted (signal ${result.signal})`
    );
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    const clean = cleanErrorLine(result.stderr);
    throw new PageFailure(
      clean || 'the AI Catalog policy engine returned an error',
      result.stderr
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(stripJfLogLines(result.stdout));
  } catch {
    throw new PageFailure('the AI Catalog policy engine returned an unreadable response');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PageFailure('the AI Catalog policy engine returned an unreadable response');
  }
  return parsed;
}

// renderScope is deliberately NOT a binary global/project check: the wire
// schema is a discriminated union with at least a third "application"
// variant (an AppTrust-lifecycle scope, per prior research into the UI's
// own Policy model) that this listing has no reason to expect for a
// use_skill policy, but must not silently mislabel as "Project" if it (or
// any future/unrecognized value) ever appears.
function renderScope(scope) {
  const type = scope && scope.type;
  if (type === 'global') return 'Global';
  if (type === 'project') return 'Project';
  return type ? `Other (${type})` : '—';
}

// renderAction mirrors renderScope's handling of an unrecognized value:
// never silently pass a raw, un-normalized wire value straight into the
// table with no signal that it wasn't one of the two known modes.
function renderAction(mode) {
  if (mode === 'block') return 'Block';
  if (mode === 'warning' || mode === 'warn') return 'Warn';
  return mode ? `Other (${mode})` : '—';
}

// neutralizeJoinDelimiter replaces any literal occurrence of the delimiter
// this function's caller is about to join multiple values WITH, inside a
// single value, so joining several rules' text can never be confused with
// one rule whose own name/description happens to contain that same
// delimiter.
function neutralizeJoinDelimiter(value) {
  return value.replace(/;\s*/g, ', ');
}

// renderRuleTypeAndCondition lists EVERY rule's type/condition explicitly
// (semicolon-joined) rather than the first one plus a bare "+N more" count
// — a policy with two DIFFERENT rule types (not just multiple copies of one
// kind) must not have the second one's type/condition hidden behind a
// generic count, since that's exactly the information this listing exists
// to surface. (Verified elsewhere that a policy is expected to carry
// exactly one rule in current UP builds — this exists for whenever that
// assumption doesn't hold, not because it's expected to trigger today.)
function renderRuleTypeAndCondition(policy) {
  const rules = Array.isArray(policy.rules) ? policy.rules : [];
  if (rules.length === 0) {
    return { ruleType: '—', condition: '—' };
  }
  const parts = rules.map((r) => {
    const template =
      r && typeof r === 'object' && r.template && typeof r.template === 'object'
        ? r.template
        : {};
    return {
      name: neutralizeJoinDelimiter(String(template.name || '—')),
      description: neutralizeJoinDelimiter(String(template.description || '—')),
    };
  });
  return {
    ruleType: parts.map((p) => p.name).join('; '),
    condition: parts.map((p) => p.description).join('; '),
  };
}

function main() {
  const { project, serverId } = parseArgs(process.argv.slice(2));
  if (!project || !serverId) {
    process.stderr.write(
      'usage: list-skill-policies.mjs --project <PROJECT> --server-id <SID>\n'
    );
    process.exitCode = 2;
    throw DONE;
  }

  let allItems = [];
  let offset = 0;
  let truncated = false;
  const startedAt = Date.now();

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0 && Date.now() - startedAt > OVERALL_BUDGET_MS) {
      // An honest partial result, not a silent one: same wording as hitting
      // MAX_PAGES, since both mean "we stopped before confirming there was
      // nothing more."
      truncated = true;
      break;
    }

    try {
      const data = fetchPage(project, serverId, offset);

      // `items: null` (with page_size/limit: 0) is the API's own confirmed,
      // live-verified shape for "zero results" — NOT malformed, and must be
      // treated as an empty page, same as `items: []` or the key being
      // absent. Anything else that isn't an array (a string, a number, an
      // object) IS malformed: silently coercing that to empty would drop
      // real policies with no error and no truncation flag, since a later
      // page could still look like a normal, non-final page.
      if (data.items !== null && data.items !== undefined && !Array.isArray(data.items)) {
        throw new PageFailure('the AI Catalog policy engine returned an unreadable response');
      }
      const items = Array.isArray(data.items) ? data.items : [];
      // A non-object element (null, a string, ...) would throw deep inside
      // rendering later — an unreadable page, same as the items-shape check
      // above, not a per-item omission that would silently under-report.
      if (items.some((item) => item === null || typeof item !== 'object' || Array.isArray(item))) {
        throw new PageFailure('the AI Catalog policy engine returned an unreadable response');
      }
      allItems = allItems.concat(items);

      // Ground truth is the array actually returned, not the metadata field
      // alone — if the backend's page_size ever disagrees with reality (e.g.
      // echoing the requested limit regardless of actual count), trusting
      // page_size alone could keep "paginating" empty pages until MAX_PAGES
      // and wrongly report truncation. Continue only when BOTH signals agree
      // the page was full.
      const reportedFull =
        typeof data.page_size === 'number' ? data.page_size >= PAGE_LIMIT : true;
      if (items.length < PAGE_LIMIT || !reportedFull) {
        break;
      }
      if (page + 1 === MAX_PAGES) {
        truncated = true;
      }
      offset += PAGE_LIMIT;
    } catch (error) {
      if (!(error instanceof PageFailure)) {
        throw error; // a genuine bug, not a page-level failure: propagate as-is
      }
      if (page > 0 && allItems.length > 0) {
        // A later page failed, but earlier pages already succeeded — an
        // honest partial answer (clearly flagged) serves the user better
        // than discarding real, already-fetched data over one bad page.
        // Nothing has been written to stderr and no exitCode has been set
        // yet (PageFailure carries the failure without reporting it), so
        // there is nothing to undo here — this is a clean, silent recovery.
        truncated = true;
        break;
      }
      // The very first page failed, or nothing has been recovered yet:
      // this is a real, total failure — NOW actually report it.
      fail(error.reason, error.stderrText);
    }
  }

  if (allItems.length === 0) {
    // Deliberately one generic line: an empty result is indistinguishable,
    // at this API, from "you can't see this project's policies" — do not
    // guess at which one it is (see references/listing-policies.md).
    process.stdout.write(`No AI Catalog policies apply to project \`${project}\`.\n`);
    return;
  }

  const sorted = allItems.slice().sort((a, b) => {
    const an = a && a.name ? String(a.name) : '';
    const bn = b && b.name ? String(b.name) : '';
    return an < bn ? -1 : an > bn ? 1 : 0;
  });

  const lines = [];
  lines.push(`AI Catalog policies affecting skills in project \`${project}\`:`);
  lines.push('');
  lines.push('| Policy | Scope | Rule type | Action | Condition |');
  lines.push('|--------|-------|-----------|--------|-----------|');
  for (const policy of sorted) {
    const scope = renderScope(policy.scope);
    const action = renderAction(policy.mode);
    const { ruleType, condition } = renderRuleTypeAndCondition(policy);
    lines.push(
      `| \`${escapeCell(policy.name)}\` | ${escapeCell(scope)} | ${escapeCell(ruleType)} | ${escapeCell(action)} | ${escapeCell(condition)} |`
    );
  }
  if (truncated) {
    lines.push('');
    lines.push(
      `(Showing the first ${sorted.length} polic${sorted.length === 1 ? 'y' : 'ies'} found within this lookup's bounds; more may apply to this project.)`
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
}

try {
  main();
} catch (error) {
  if (error !== DONE) {
    // Last-resort guard: an unexpected bug must not leak a raw stack trace
    // (which could itself contain the internal service name/path) to the
    // user. Downgrade to the same clean, scrubbed shape as every other
    // failure — never rethrow past this point.
    process.stderr.write(
      'Listing AI Catalog policies failed: an unexpected error occurred.\n'
    );
    process.exitCode = 1;
  }
}
