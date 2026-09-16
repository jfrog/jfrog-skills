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
//   plus markdown table, or the one-line "no policies" fallback. Never raw
//   JSON; the caller does no parsing.
// stderr + exit 1: the call, or the response it returned, could not be used.
//   stderr is one line, already safe to present verbatim — the internal
//   service name, its path, the query string, and any Trace ID are always
//   scrubbed before this script ever prints an error. Every failure path
//   goes through fail(), so scrubbing lives in exactly one place.
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

import { spawnSync } from 'node:child_process';

const PAGE_LIMIT = 250;
// Bounded, not browsable: this answer must be complete, so pages are fetched
// silently up to a generous safety cap rather than asked about one at a
// time. If the cap is ever actually hit, that's flagged, not silently
// presented as the complete list.
const MAX_PAGES = 8;
// Aggregate budget across ALL pages, independent of each call's own 30s
// timeout — 8 sequential calls could otherwise compound to several minutes
// with no overall bound for what is framed as a quick lookup.
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

// cleanErrorLine reduces jf's (possibly multi-line) stderr to one line safe
// to present verbatim: drop every line mentioning a Trace ID, take the last
// remaining non-empty line, then scrub any URL/path or plain-English mention
// naming the internal service. Never throws — undefined/empty input yields
// ''.
function cleanErrorLine(stderrText) {
  const lines = (stderrText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.includes('Trace ID'));
  let last = lines.length ? lines[lines.length - 1] : '';
  last = last
    .replace(/https?:\/\/\S*\/unifiedpolicy\/\S*/g, 'the AI Catalog policy engine')
    .replace(/\/unifiedpolicy\/\S*/g, 'the AI Catalog policy engine')
    // A backend error BODY (not just a URL/path) can name the internal
    // service in plain English (e.g. "Unified Policy entitlement
    // required") — the two replacements above only catch URL/path-shaped
    // occurrences, so this catches the phrase itself, case-insensitively.
    .replace(/unified[\s-]?policy/gi, 'AI Catalog policy engine');
  return last;
}

// fail is the ONLY way this script reports a runtime (non-usage) failure, so
// scrubbing lives in exactly one place. stderrText, if given, is jf's own
// stderr — used only to extract an HTTP status, never re-printed raw.
function fail(reason, stderrText) {
  const status = httpStatus(stderrText);
  const prefix = status
    ? `Listing AI Catalog policies failed (HTTP ${status}): `
    : 'Listing AI Catalog policies failed: ';
  process.stderr.write(prefix + reason + '\n');
  process.exitCode = 1;
  throw DONE;
}

// escapeCell makes a value safe as one markdown table cell: a literal `|`
// or embedded newline in a user-authored policy name (or a custom rule's
// name/description) would otherwise corrupt the table's row structure, and
// a literal backtick would break out of the inline-code span the Policy
// column wraps its value in.
function escapeCell(value) {
  const s = value === undefined || value === null || value === '' ? '—' : String(value);
  return s.replace(/\|/g, '\\|').replace(/`/g, "'").replace(/\r?\n/g, ' ');
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
    // empty in this case, so there is nothing to scrub. `killed`/ETIMEDOUT
    // is the actual Node contract for an exceeded `timeout` (matches
    // jfrog-agent-guard-check.mjs's jfFailure()); everything else is a
    // distinct, generic spawn failure.
    if (result.error.code === 'ETIMEDOUT' || result.killed === true) {
      fail('the AI Catalog policy engine took too long to respond');
    }
    fail('could not run the jf CLI');
  }
  if (result.signal) {
    // A signal without result.error (seen on some Node/OS combinations for
    // a timeout kill) is reported factually, not attributed to a specific
    // cause this script cannot actually confirm (a user-sent SIGINT and an
    // OS OOM-kill both land here too, and are not "did not respond").
    fail(`the AI Catalog policy engine call was interrupted (signal ${result.signal})`);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    const clean = cleanErrorLine(result.stderr);
    fail(clean || 'the AI Catalog policy engine returned an error', result.stderr);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    fail('the AI Catalog policy engine returned an unreadable response');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('the AI Catalog policy engine returned an unreadable response');
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
      name: template.name || '—',
      description: template.description || '—',
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

    const data = fetchPage(project, serverId, offset); // throws DONE on failure
    // `items: null` (with page_size/limit: 0) is the API's own confirmed,
    // live-verified shape for "zero results" — NOT malformed, and must be
    // treated as an empty page, same as `items: []` or the key being
    // absent. Anything else that isn't an array (a string, a number, an
    // object) IS malformed: silently coercing that to empty would drop
    // real policies with no error and no truncation flag, since a later
    // page could still look like a normal, non-final page.
    if (data.items !== null && data.items !== undefined && !Array.isArray(data.items)) {
      fail('the AI Catalog policy engine returned an unreadable response');
    }
    const items = Array.isArray(data.items) ? data.items : [];
    allItems = allItems.concat(items);

    const pageSize = typeof data.page_size === 'number' ? data.page_size : items.length;
    if (pageSize < PAGE_LIMIT) {
      break;
    }
    if (page + 1 === MAX_PAGES) {
      truncated = true;
    }
    offset += PAGE_LIMIT;
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
      `| \`${escapeCell(policy.name)}\` | ${scope} | ${escapeCell(ruleType)} | ${escapeCell(action)} | ${escapeCell(condition)} |`
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
