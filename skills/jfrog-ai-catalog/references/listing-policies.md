# Listing skill governance policies

Answers "what policies apply to skills in this project?" **before** the user
tries to install or run one — proactively, not as a reaction to a blocked
download. These are **AI Catalog policies** (the AI Catalog's own governance
engine: allow-lists, malicious-skill checks, block/warn modes) for **skills**,
distinct from two other systems that also use the word "policy" or
"approved" in this project:
- Xray's repository watches — a separate system; do not conflate the two,
  and do not reuse this flow for an Xray/Curation "blocked by policy"
  message — see *Handling a blocked download* in `installing-skills.md`.
- MCP approval/allow status — a different asset type entirely, owned by
  `jfrog-mcp-management`, not this skill, even when the user says "policy"
  or "approved" while actually asking about an MCP server.

**Never say "Unified Policy" to the user.** That's the internal service name
behind this flow — plumbing, like every other backend this skill family
talks to. Call it an "AI Catalog policy" (or just "policy") in anything you
say to the user, the same way the rest of this skill never surfaces
`npx`/Agent Guard internals.

## List the policies

The query, auto-pagination, and error-scrubbing are **all owned by a bundled
script** — this is fully deterministic once `<PROJECT>` and `<SID>` are
known, so none of it is left to be reconstructed freehand each time.
Presentation is not: the script hands back structured data, and you build
the response.

Resolve `<PROJECT>` per **Resolve the project** in `../SKILL.md`'s
Prerequisites (never assume `default`, never invent one), then run:

```bash
node <skill_path>/scripts/list-skill-policies.mjs --project "<PROJECT>" --server-id "<SID>"
```

Always invoke via `node <path>` — never execute the file directly.

- **stdout, exit 0**: one JSON object with three keys — `message`, `note`,
  `policies`.
  - If `message` is non-null, present that string **verbatim** and stop —
    ignore `policies` and `note` entirely. Never build a table for this
    case, and never reword it: it deliberately covers two different
    situations ("no policies apply" and "not authorized to see them") with
    one honest, non-guessing message — see the Gotchas below.
  - Otherwise, build the response from `policies` — an array of
    `{ name, scope, action, rules: [{ type, condition }] }`. A markdown
    table (Policy / Scope / Rule type / Action / Condition) is the natural
    shape, but you decide the exact presentation for your harness; a
    policy with multiple `rules` can be one row per rule or one row with
    joined values, your call. `scope`/`action`/`type`/`condition` are
    `null` when the wire value was absent or unrecognized — render that
    however fits (e.g. "—" or "unspecified"), just don't invent a value.
    Any literal `|`, backtick, or newline inside a `name`/`type`/`condition`
    is real user-authored content, not markdown syntax — escape it
    yourself if you render a table.
  - If `note` is non-null, append it **verbatim** after your response —
    it distinguishes a project simply having enough policies to hit the
    lookup's safety cap from a later page genuinely failing to load after
    earlier ones already succeeded (an honest partial answer, not a total
    failure, since real data is already in hand). Don't reword it or
    collapse it into a generic "capped" message.
- **stderr, exit 1**: the call itself failed (for any reason — including the
  account lacking the AI Catalog entitlement; the script does not pre-check
  entitlement separately, since that check does not reliably reflect whether
  this specific capability is available). stderr is a single line with any
  Trace ID dropped and the internal service's own name/URL replaced — present
  it verbatim as the failure. Do not speculate about *why* it failed beyond
  what that line says.
- **exit 2**: a usage error (missing `--project`/`--server-id`) — a bug in
  how the script was invoked, not something to show the user as a policy
  answer.

## Gotchas

- **Never expose the "Unified Policy" name, its API path, or any other
  internal service detail to the user.** Present everything as an "AI
  Catalog policy" — this applies to prose, error messages, and any
  follow-up explanation you build from `policies`, not just the parts the
  script already scrubs on its own (`message`/`note`, and each field value).
- **Don't leak the plumbing.** Never show the user the script invocation,
  the underlying `jf api` call, or the raw JSON itself — parse it and
  present your own rendering of `policies`, not the wire shape.
- **A policy's Action is independent of its Rule type's own allow/block
  semantics.** Action is the *enforcement* mode (does a match block or just
  warn); Rule type is *what* it matches on (an allow-list, a malicious-skill
  check, etc.) — keep these as separate fields in whatever you render;
  don't collapse them when talking about a result.
- **The empty-result `message` already states both possibilities — don't
  strip that down to just "no policies apply" when relaying it.** The
  backend returns the identical empty result for "nothing here" and "you
  can't see this," with no non-admin way to tell them apart (the same
  limitation already noted for project-key validation in `../SKILL.md`), so
  the message itself names both. Present it whole; don't paraphrase it into
  a more confident-sounding claim than it makes.
