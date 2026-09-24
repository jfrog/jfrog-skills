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
// Windows / jf as a .cmd or .bat shim: this repo's own canonical Windows
// install (skills/jfrog-init/scripts/jfrog-install-jf-cli.mjs) places a
// native jf.exe, which is the common case this script directly supports.
// A customer's `jf` COULD reach PATH some other way (a corporate wrapper,
// a third-party package manager) producing a .cmd/.bat shim instead, which
// plain spawnSync cannot execute without shell:true — a real, narrower gap
// this script does not attempt to close.
//
// A shell-quoted invocation was tried and reverted: this script's own path
// argument always contains literal "&" (its query-string separators), and
// safely caret-escaping that specifically for cmd.exe's notoriously
// inconsistent metacharacter parsing is not something verifiable without a
// real Windows environment to test against — confirmed empirically in this
// session that neither a naive "reject any special character" check (it
// rejected this script's own argument on every call) nor Node's
// shell:true + array-args form (which Node's own deprecation warning says
// does NOT escape arguments, only concatenates them — verified live: a
// crafted argument was silently split at "&") are safe, correct answers
// here. Shipping an unverified hand-rolled escape scheme for this exact
// history of subtle, security-relevant bugs was judged worse than the
// plain, simple spawn below, which matches skills/jfrog/scripts/
// jfrog-check-server-collision.mjs's existing precedent (also no shell
// handling) for the common, verified case.

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

// KNOWN_FLAGS, not "anything starting with --": a real --server-id value is
// user-chosen and not guaranteed to avoid a leading "--" (jf places no such
// restriction on server ids) — rejecting every "--"-prefixed token as "must
// be the next flag" would wrongly refuse a legitimate value shaped that
// way. Only recognizing this script's own actual flag names avoids that
// false rejection while still catching the real "missing value" case this
// function exists for.
const KNOWN_FLAGS = new Set(['--project', '--server-id']);

// takeValue consumes the token after a flag as its value, but only if that
// token isn't itself one of this script's OWN recognized flags — otherwise
// a missing value (e.g. `--project --server-id abc`) would silently
// swallow the next flag's name as if it were this flag's value, and the
// real problem (a missing --project value) would never be reported.
function takeValue(argv, i, flagName) {
  const next = argv[i + 1];
  if (next === undefined || KNOWN_FLAGS.has(next)) {
    process.stderr.write(
      `list-skill-policies.mjs: ${flagName} requires a value\n`
    );
    process.exitCode = 2;
    throw DONE;
  }
  return next;
}

function parseArgs(argv) {
  const args = { project: '', serverId: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') {
      args.project = takeValue(argv, i, '--project');
      i++;
    } else if (a === '--server-id') {
      args.serverId = takeValue(argv, i, '--server-id');
      i++;
    } else {
      process.stderr.write(`list-skill-policies.mjs: unknown argument: ${a}\n`);
      process.exitCode = 2;
      throw DONE;
    }
  }
  // Trim: a whitespace-only value (e.g. an upstream templating bug passing
  // "--server-id \" \"") is truthy in JS and must not slip past the usage
  // check below as if it were a real value.
  args.project = args.project.trim();
  args.serverId = args.serverId.trim();
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
//
// Deliberately "last line" only, not a search for "the most informative
// line": every real failure observed live (400/403/500, a retry-exhausted
// timeout) had its most specific, actionable text on the LAST line. Trying
// to be smarter about which line is "the real reason" — or presenting more
// than one line — risks re-exposing raw multi-line body content (a JSON
// error blob, an internal stack fragment) that scrubbing isn't guaranteed
// to fully sanitize; one bounded, scrubbed line is the safer tradeoff.
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
  const result = spawnSync('jf', ['api', '--server-id', serverId, path], {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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
  // null | 'cap' | 'failure' — NOT just a boolean: a benign safety-cap/
  // time-budget stop and a genuine later-page backend failure both leave
  // the user with a partial list, but they are not the same event and must
  // not read as identical in the final message.
  let truncatedReason = null;
  const startedAt = Date.now();

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0 && Date.now() - startedAt > OVERALL_BUDGET_MS) {
      truncatedReason = 'cap';
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

      // Ground truth is ONLY the array actually returned — the page_size
      // metadata field is not trusted in either direction. Trusting it as a
      // "the backend claims this page is full" signal (even ANDed with the
      // actual length) previously broke the case where page_size under-
      // reports a genuinely full page: that combination stopped pagination
      // silently, with truncatedReason never set, even though items.length
      // itself already proved more data existed.
      if (items.length < PAGE_LIMIT) {
        break;
      }
      if (page + 1 === MAX_PAGES) {
        truncatedReason = 'cap';
      }
      offset += PAGE_LIMIT;
    } catch (error) {
      if (!(error instanceof PageFailure)) {
        throw error; // a genuine bug, not a page-level failure: propagate as-is
      }
      // page > 0 alone is sufficient here (not also checking
      // allItems.length > 0): reaching page > 0 at all requires the PRIOR
      // iteration to have completed its `items.length < PAGE_LIMIT` check
      // above without breaking, i.e. a full PAGE_LIMIT of items was already
      // appended to allItems — so allItems.length > 0 always already holds.
      // Not re-checked, to avoid a second condition that looks independently
      // load-bearing but isn't; if a future change loosens that invariant,
      // this comment is the thing to revisit.
      if (page > 0) {
        // A later page failed, but earlier pages already succeeded — an
        // honest partial answer (clearly flagged, and distinguishably so —
        // see truncatedReason) serves the user better than discarding real,
        // already-fetched data over one bad page. Nothing has been written
        // to stderr and no exitCode has been set yet (PageFailure carries
        // the failure without reporting it), so there is nothing to undo
        // here — this is a clean, silent recovery.
        truncatedReason = 'failure';
        break;
      }
      // The very first page failed: this is a real, total failure — NOW
      // actually report it.
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
  if (truncatedReason) {
    // Never "first N" — the table above is sorted alphabetically for
    // display, but that sort happens AFTER pagination stopped, so it does
    // NOT correspond to which policies were actually fetched; "first N"
    // would misleadingly read as an alphabetical prefix guarantee.
    const note =
      truncatedReason === 'failure'
        ? `This is a partial list (${sorted.length} polic${sorted.length === 1 ? 'y' : 'ies'}) — a later page failed to load, so more may apply to this project beyond what's shown here.`
        : `This is a partial list (${sorted.length} polic${sorted.length === 1 ? 'y' : 'ies'}) — this project has enough policies that more may apply beyond what's shown here.`;
    lines.push('');
    lines.push(`(${note})`);
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
