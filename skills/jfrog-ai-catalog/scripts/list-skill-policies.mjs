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
// shell pipeline (which is what this file replaces) for a malformed or
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

import { spawnSync } from 'node:child_process';

const PAGE_LIMIT = 250;
// Bounded, not browsable: this answer must be complete, so pages are fetched
// silently up to a generous safety cap rather than asked about one at a
// time. If the cap is ever actually hit, that's flagged, not silently
// presented as the complete list.
const MAX_PAGES = 8;

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
      process.exit(2);
    }
  }
  return args;
}

// httpStatus mirrors the base jfrog skill's shared jf_api_http_status.sh
// helper (skills/jfrog/scripts/lib/jf-api-http-status.sh): last "Http
// Status: NNN" line in jf's stderr, or null if none is present.
function httpStatus(stderrText) {
  if (!stderrText) return null;
  const matches = [...stderrText.matchAll(/Http Status:\s*(\d+)/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

// cleanErrorLine reduces jf's (possibly multi-line) stderr to one line safe
// to present verbatim: drop every line mentioning a Trace ID, take the last
// remaining non-empty line, then scrub any URL/path naming the internal
// service. Never throws — undefined/empty input yields ''.
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
  process.exit(1);
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

  // Matches the shared jfrog-check-server-collision.mjs precedent
  // (skills/jfrog/scripts/): explicit timeout, plain `jf` (no shell: true —
  // it's a native compiled binary, not an npm shim on any platform, so
  // PATH-based resolution is enough on Windows too).
  const result = spawnSync('jf', ['api', path, '--server-id', serverId], {
    encoding: 'utf8',
    timeout: 30_000,
  });

  if (result.error) {
    // spawn itself failed — result.stderr is empty in this case, so there
    // is nothing to scrub. Distinguish a timeout (verified: on this Node
    // version, an exceeded `timeout` sets result.error with code
    // ETIMEDOUT/ETIMEOUT rather than only result.signal) from every other
    // spawn failure (e.g. `jf` missing from PATH), since they read very
    // differently to a user.
    if (result.error.code === 'ETIMEDOUT' || result.error.code === 'ETIMEOUT') {
      fail('the AI Catalog policy engine took too long to respond');
    }
    fail('could not run the jf CLI');
  }
  if (result.signal) {
    // Belt-and-braces: killed by a signal without result.error being set
    // (seen on some Node/OS combinations for a timeout kill, unlike the
    // one verified above) — status is null, not non-zero, so the check
    // below alone would not catch it and this call would otherwise hang
    // with no bound at all.
    fail(`the AI Catalog policy engine did not respond (${result.signal})`);
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

function renderAction(mode) {
  if (mode === 'block') return 'Block';
  if (mode === 'warning' || mode === 'warn') return 'Warn';
  return mode || '—';
}

function renderRuleTypeAndCondition(policy) {
  const rules = Array.isArray(policy.rules) ? policy.rules : [];
  const ruleCount = rules.length;
  const first = rules[0] && typeof rules[0] === 'object' ? rules[0] : {};
  const template = first.template && typeof first.template === 'object' ? first.template : {};
  const baseType = template.name || '—';
  const ruleType = ruleCount > 1 ? `${baseType} (+${ruleCount - 1} more)` : baseType;
  const condition = template.description || '—';
  return { ruleType, condition };
}

function main() {
  const { project, serverId } = parseArgs(process.argv.slice(2));
  if (!project || !serverId) {
    process.stderr.write(
      'usage: list-skill-policies.mjs --project <PROJECT> --server-id <SID>\n'
    );
    process.exit(2);
  }

  let allItems = [];
  let offset = 0;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = fetchPage(project, serverId, offset); // exits on any failure
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
    process.exit(0);
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
      `(Showing the first ${MAX_PAGES * PAGE_LIMIT} policies; more may apply to this project.)`
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
}

main();
