#!/usr/bin/env node
// list-skill-policies.mjs — deterministic listing of AI Catalog governance
// policies (project-scoped + Global, merged) for skills in one project.
// Owns the query, pagination, and scrubbing of internal service details;
// presentation (e.g. building a table) is the caller's job, not this
// script's — it hands back structured data, not pre-rendered text.
//
// Usage:
//   node list-skill-policies.mjs --project <PROJECT> --server-id <SID>
//
// stdout (exit 0): one JSON object, always with these three keys:
//   - message: non-null only for "no policies apply" (or indistinguishably,
//     not authorized to see them) — present this string verbatim and ignore
//     `policies`/`note` entirely; never build a table for an empty result.
//   - policies: array of { name, scope, action, rules: [{type, condition}] }.
//     scope/action/type/condition are null when the wire value was absent
//     or unrecognized — the caller decides how to display that.
//   - note: non-null only when the list is a partial one (safety cap or a
//     later page failing after earlier ones succeeded) — append this string
//     verbatim after presenting `policies`.
// stderr + exit 1: nothing usable could be produced (first page failed, or
//   response unreadable). stderr is one line with any Trace ID dropped and
//   the internal service's own name/URL replaced via fail() — not a
//   blanket guarantee over every path or service name that could appear on
//   that line. A failure on a LATER page, once one page already succeeded,
//   does not take this path — see the pagination loop.
// exit 2: usage error (missing --project/--server-id).
//
// Calls the AI Catalog policy engine via `jf api` on the JPD directly;
// credentials stay inside jf's own resolved config, never read directly by
// this script.
//
// Every exit path sets process.exitCode and unwinds via the DONE sentinel
// instead of calling process.exit() directly: a synchronous exit() can
// truncate a pending stdout/stderr write on pipes/TTYs.
//
// spawnSync runs `jf` with shell:false: this script's own path argument
// always contains a literal "&" (query-string separator), and Node's
// shell:true + array-args form does not escape arguments — confirmed it
// silently splits on "&". A customer's `jf` reachable only via a .cmd/.bat
// shim (not this repo's own jf.exe install) would need shell:true to run
// at all; that narrower gap is not addressed here.

import { spawnSync } from 'node:child_process';

const PAGE_LIMIT = 250;
// Pages fetch silently up to this safety cap; hitting it is flagged in the
// output, never silently presented as the complete list.
const MAX_PAGES = 8;
// Checked only between pages, not sub-page, so this bounds fetches from
// STARTING rather than guaranteeing a hard ceiling — still far better than
// no aggregate bound (MAX_PAGES slow-but-not-hung calls could otherwise
// compound to several minutes for what should be a quick lookup).
const OVERALL_BUDGET_MS = 60_000;

const DONE = Symbol('list-skill-policies:done');

// A --server-id value could itself start with "--" (jf places no such
// restriction), so only this script's own known flag names are treated as
// "must be the next flag" — anything else is accepted as a value.
const KNOWN_FLAGS = new Set(['--project', '--server-id']);

// Rejects the next token as a value if it's itself a known flag — otherwise
// a missing value (e.g. `--project --server-id abc`) would silently swallow
// the next flag's name instead of reporting the real "missing value" error.
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
  // A whitespace-only value is truthy in JS and must not slip past the
  // usage check below as if it were real.
  args.project = args.project.trim();
  args.serverId = args.serverId.trim();
  return args;
}

// Scans the whole text for either status line format jf can print
// ("Http Status: NNN" or "[Warn] ... returned NNN"), last-match-wins so a
// real failure after a retry's own status line isn't shadowed by an
// earlier one.
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

// Applied on both the failure path and the success path — a rule's own
// name/description is admin-authored and could legitimately contain the
// internal service name, which must never reach the user either way.
function scrubServiceName(text) {
  return String(text || '')
    .replace(/https?:\/\/\S*\/unifiedpolicy\/\S*/g, 'the AI Catalog policy engine')
    .replace(/\/unifiedpolicy\/\S*/g, 'the AI Catalog policy engine')
    .replace(/unified[\s-]?policy/gi, 'AI Catalog policy engine');
}

// Drops any line mentioning a Trace ID, takes the last remaining non-empty
// line, then scrubs it. Last-line-only, not "most informative line": every
// observed failure (400/403/500, retry-exhausted timeout) has its most
// actionable text last, and presenting more than one line risks re-exposing
// raw body content scrubbing isn't guaranteed to fully sanitize.
function cleanErrorLine(stderrText) {
  const lines = (stderrText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.includes('Trace ID'));
  const last = lines.length ? lines[lines.length - 1] : '';
  return scrubServiceName(last);
}

// The only place that writes a runtime failure to stderr. stderrText, if
// given, is used only to extract an HTTP status, never re-printed raw. Does
// not decide whether a failure is reportable — see PageFailure below.
function fail(reason, stderrText) {
  const status = httpStatus(stderrText);
  const prefix = status
    ? `Listing AI Catalog policies failed (HTTP ${status}): `
    : 'Listing AI Catalog policies failed: ';
  process.stderr.write(prefix + reason + '\n');
  process.exitCode = 1;
  throw DONE;
}

// Carries a page-level failure without writing anything yet, so the
// pagination loop can decide whether to recover (degrade to a truncated but
// still-successful result) before anything hits stderr/exitCode.
class PageFailure extends Error {
  constructor(reason, stderrText) {
    super(reason);
    this.reason = reason;
    this.stderrText = stderrText;
  }
}

// Drops jf's own "[Info]"/"[Warn]" log lines before JSON.parse — these are
// supposed to go to stderr only, but a mix-up would otherwise turn a valid
// response into a parse failure.
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

  // Flags before the path: a past jf CLI (2.120+) parser regression treated
  // a flag placed after the path as a positional argument (see
  // jfrog-login-register-session.sh) — this order is required, not stylistic.
  const result = spawnSync('jf', ['api', '--server-id', serverId, path], {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    // spawn itself failed (e.g. `jf` not found) — result.stderr is empty, so
    // nothing to scrub. On timeout, spawnSync sets error.code to 'ETIMEDOUT'
    // but never sets a `killed` property (unlike execFileSync/execSync).
    if (result.error.code === 'ETIMEDOUT') {
      throw new PageFailure('the AI Catalog policy engine took too long to respond');
    }
    throw new PageFailure('could not run the jf CLI');
  }
  if (result.signal) {
    // Reported factually, not as "did not respond" — a user-sent SIGINT or
    // an OS OOM-kill both land here too, and this script can't tell which.
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

// Not a binary global/project check: the wire schema has at least a third
// "application" scope variant (AppTrust lifecycle) not expected for a
// use_skill policy, but it must not be silently mislabeled as "Project" if
// it (or any future value) appears. null (not a placeholder string) marks
// "absent" — the caller decides how to present that in its own format.
function renderScope(scope) {
  const type = scope && scope.type;
  if (type === 'global') return 'Global';
  if (type === 'project') return 'Project';
  return type ? `Other (${type})` : null;
}

// Mirrors renderScope: never pass a raw, un-normalized wire value through
// with no signal that it wasn't one of the two known modes.
function renderAction(mode) {
  if (mode === 'block') return 'Block';
  if (mode === 'warning' || mode === 'warn') return 'Warn';
  return mode ? `Other (${mode})` : null;
}

// Every rule as its own {type, condition} object — not joined into one
// string — so a policy with several rules loses nothing and needs no join
// delimiter to begin with. The caller decides how to present multiple rules.
function renderRules(policy) {
  const rules = Array.isArray(policy.rules) ? policy.rules : [];
  return rules.map((r) => {
    const template =
      r && typeof r === 'object' && r.template && typeof r.template === 'object'
        ? r.template
        : {};
    return {
      type: template.name ? scrubServiceName(String(template.name)) : null,
      condition: template.description ? scrubServiceName(String(template.description)) : null,
    };
  });
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
  // null | 'cap' | 'failure': a benign safety-cap/budget stop and a genuine
  // later-page failure both leave a partial list, but must not read as the
  // same event in the final message.
  let truncatedReason = null;
  const startedAt = Date.now();

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0 && Date.now() - startedAt > OVERALL_BUDGET_MS) {
      truncatedReason = 'cap';
      break;
    }

    try {
      const data = fetchPage(project, serverId, offset);

      // `items: null` is the API's confirmed shape for "zero results", not
      // malformed — treated as an empty page. Anything else non-array IS
      // malformed: coercing that to empty would drop real policies with no
      // error and no truncation flag.
      if (data.items !== null && data.items !== undefined && !Array.isArray(data.items)) {
        throw new PageFailure('the AI Catalog policy engine returned an unreadable response');
      }
      const items = Array.isArray(data.items) ? data.items : [];
      // A non-object element would throw deep inside rendering later — an
      // unreadable page, not a per-item omission that would under-report.
      if (items.some((item) => item === null || typeof item !== 'object' || Array.isArray(item))) {
        throw new PageFailure('the AI Catalog policy engine returned an unreadable response');
      }
      allItems = allItems.concat(items);

      // Ground truth is only the array actually returned — the page_size
      // metadata field is not trusted: it has under-reported a genuinely
      // full page before, which silently stopped pagination early.
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
      // page > 0 implies a full PAGE_LIMIT was already appended to allItems
      // (the prior iteration's `items.length < PAGE_LIMIT` check didn't
      // break), so allItems.length > 0 always holds — not re-checked.
      if (page > 0) {
        // A later page failed after earlier ones succeeded — an honest
        // partial answer (flagged via truncatedReason) beats discarding
        // real, already-fetched data over one bad page.
        truncatedReason = 'failure';
        break;
      }
      // The very first page failed: this is a real, total failure — NOW
      // actually report it.
      fail(error.reason, error.stderrText);
    }
  }

  if (allItems.length === 0) {
    // The message itself hedges, not just a doc note about it: an empty
    // result is indistinguishable, at this API, from "you can't see this
    // project's policies," so the string presented to the user must not
    // assert "no policies apply" as settled fact.
    process.stdout.write(
      JSON.stringify({
        message: `No AI Catalog policies apply to project \`${project}\` — or this account isn't authorized to see them; those two look identical from here.`,
        note: null,
        policies: [],
      }) + '\n'
    );
    return;
  }

  const sorted = allItems.slice().sort((a, b) => {
    const an = a && a.name ? String(a.name) : '';
    const bn = b && b.name ? String(b.name) : '';
    return an < bn ? -1 : an > bn ? 1 : 0;
  });

  const policies = sorted.map((policy) => ({
    name: policy.name ? scrubServiceName(String(policy.name)) : null,
    scope: renderScope(policy.scope),
    action: renderAction(policy.mode),
    rules: renderRules(policy),
  }));

  // Never "first N": the array above is sorted alphabetically for display,
  // but that sort happens AFTER pagination stopped, so it does NOT
  // correspond to which policies were actually fetched.
  let note = null;
  if (truncatedReason) {
    const count = policies.length;
    note =
      truncatedReason === 'failure'
        ? `This is a partial list (${count} polic${count === 1 ? 'y' : 'ies'}) — a later page failed to load, so more may apply to this project beyond what's shown here.`
        : `This is a partial list (${count} polic${count === 1 ? 'y' : 'ies'}) — this project has enough policies that more may apply beyond what's shown here.`;
  }

  process.stdout.write(JSON.stringify({ message: null, note, policies }) + '\n');
}

try {
  main();
} catch (error) {
  if (error !== DONE) {
    // Last-resort guard: an unexpected bug must not leak a raw stack trace
    // to the user. Never rethrow past this point.
    process.stderr.write(
      'Listing AI Catalog policies failed: an unexpected error occurred.\n'
    );
    process.exitCode = 1;
  }
}
