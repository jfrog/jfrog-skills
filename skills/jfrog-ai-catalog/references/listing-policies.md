# Listing skill governance policies

Answers "what policies apply to skills in this project?" **before** the user
tries to install or run one — proactively, not as a reaction to a blocked
download. These are **AI Catalog policies** (the AI Catalog's own governance
engine: allow-lists, malicious-skill checks, block/warn modes), a separate
system from Xray's repository watches. Do not conflate the two, and do not
reuse this flow for an Xray/Curation "blocked by policy" message — see
*Handling a blocked download* in `installing-skills.md` for that.

**Never say "Unified Policy" to the user.** That's the internal service name
behind this flow — plumbing, like every other backend this skill family
talks to. Call it an "AI Catalog policy" (or just "policy") in anything you
say to the user, the same way the rest of this skill never surfaces
`npx`/Agent Guard internals.

## List the policies

The query, auto-pagination, rendering, and error-scrubbing are **all owned by
a bundled script** — this is fully deterministic once `<PROJECT>` and `<SID>`
are known, so none of it is left to be reconstructed freehand each time.

Resolve `<PROJECT>` per *Resolve the project* in `../SKILL.md` (never assume
`default`, never invent one), then run:

```bash
node <skill_path>/scripts/list-skill-policies.mjs --project "<PROJECT>" --server-id "<SID>"
```

(Node, not bash — this skill already hard-requires Node/npx for every other
flow via `npx @jfrog/agent-guard`, so this adds no new prerequisite. Never
execute the script directly; invoke it through `node` the same way
`check-environment.sh` in the base skill is invoked through `bash`.)

- **stdout, exit 0**: finished text, ready to present **verbatim** — the
  intro line plus the policy table, or the one-line "no policies" fallback.
  The table can carry one extra trailing line — still part of the same
  verbatim block, not a separate case to react to — and its wording
  distinguishes two different reasons for a partial list: a project simply
  having enough policies to hit the lookup's safety cap, versus a later
  page genuinely failing to load after earlier ones already succeeded (an
  honest partial answer, not a total failure, since real data is already in
  hand). Both are still exit 0 — only the wording differs — so don't
  collapse them into one generic "capped" message when relaying either.
  Never parse or reformat any of this; the script has already done that.
- **stderr, exit 1**: the call itself failed (for any reason — including the
  account lacking the AI Catalog entitlement; the script does not pre-check
  entitlement separately, since that check does not reliably reflect whether
  this specific capability is available). stderr is a single line, already
  scrubbed of any internal service name, path, query string, or Trace ID —
  present it verbatim as the failure. Do not speculate about *why* it
  failed beyond what that line says.
- **exit 2**: a usage error (missing `--project`/`--server-id`) — a bug in
  how the script was invoked, not something to show the user as a policy
  answer.

## Gotchas

- **Never expose the "Unified Policy" name, its API path, or any other
  internal service detail to the user.** Present everything as an "AI
  Catalog policy" — this applies to prose, error messages, and any
  follow-up explanation, not just the script's own output (which already
  scrubs this on its own).
- **Don't leak the plumbing.** Never show the user the script invocation,
  the underlying `jf api` call, or raw JSON — only the script's finished
  stdout/stderr line(s).
- **A policy's Action is independent of its Rule type's own allow/block
  semantics.** Action is the *enforcement* mode (does a match block or just
  warn); Rule type is *what* it matches on (an allow-list, a malicious-skill
  check, etc.) — the table already keeps these as separate columns; don't
  collapse them when talking about a result.
- **"No AI Catalog policies apply" also covers not being authorized to see
  them.** The backend returns the identical empty result for "nothing here"
  and "you can't see this," with no non-admin way to tell them apart (the
  same limitation already noted for project-key validation in `../SKILL.md`).
  Don't imply the project definitely has no policies — the script's wording
  is already careful about this; don't add certainty it doesn't claim.
