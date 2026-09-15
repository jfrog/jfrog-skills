# Listing skill governance policies

Answers "what policies apply to skills in this project?" **before** the user
tries to install or run one — proactively, not as a reaction to a blocked
download. These are **AI Catalog policies** (the AI Catalog's own governance
engine: allow-lists, malicious-skill checks, block/warn modes), a separate
system from Xray's repository watches. Do not conflate the two, and do not
reuse this flow for an Xray/Curation "blocked by policy" message — see
*Handling a blocked download* in `installing-skills.md` for that.

**Never say "Unified Policy" to the user.** That's the internal service name
behind the API call below — plumbing, like every other backend this skill
family talks to. Call it an "AI Catalog policy" (or just "policy") in
anything you say to the user, the same way the rest of this skill never
surfaces `npx`/Agent Guard internals.

## Check entitlement first

Skill governance is gated on the AI Catalog entitlement. Check it before
listing policies:

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard --should-inject --server "<SID>"
```

Reads `true`/`false` from stdout; a disabled account also exits non-zero. If
`false` (or the exit code signals disabled), stop and reply using **this
exact template**:

> Skill governance policies aren't available for this account — the AI
> Catalog entitlement isn't enabled. Contact your JFrog administrator.

Only proceed to the call below once entitlement is confirmed `true`.

## List the policies

Resolve `<PROJECT>` per *Resolve the project* in `../SKILL.md` (never assume
`default`, never invent one), then call the AI Catalog policy engine
**directly** — this is not an Artifactory or Xray product, so it isn't in the
base skill's `jf api` product-prefix table, but the same authenticated
`jf api` mechanism reaches it on the same JPD:

```bash
jf api "/unifiedpolicy/api/v1/policies?action_type=use_skill&project_key=<PROJECT>&hierarchical=true&expand=rules&limit=250" \
  --server-id "<SID>"
```

(The `/unifiedpolicy/...` path is the real, internal endpoint — never repeat
that name back to the user; see above.)

- `action_type=use_skill` scopes to skill-governance policies only.
- `hierarchical=true` is what returns **both** project-scoped and Global-scope
  policies in one call — Global policies apply to every project, so they
  belong in the same answer. Do not make a second call for Global scope; it's
  already merged in.
- `expand=rules` inlines each policy's rule (and its template) in the same
  response — no follow-up call per policy.
- If the response's `page_size` equals the `limit` you passed, more may
  exist: tell the user and offer to fetch the next page with `offset`. Do not
  silently page through everything.

## Presenting results (use this exact template)

Render one row per item in the response, sorted by policy name, and nothing
else (no raw JSON, no query params, no `project_key`/`hierarchical` plumbing,
and no mention of "Unified Policy"):

AI Catalog policies affecting skills in project `<PROJECT>`:

| Policy | Scope | Rule type | Action | Condition |
|--------|-------|-----------|--------|-----------|
| `<name>` | `<Global \| Project>` | `<rule.template.name>` | `<Block \| Warn>` | `<rule.template.description>` |

- **Scope**: read `scope.type` — `global` → `Global`, `project` → `Project`.
- **Action**: read the policy's `mode` — `block` → `Block`, `warning`/`warn` →
  `Warn`.
- **Rule type** and **Condition** come from the expanded rule's own
  `template.name` / `template.description` (a custom rule still carries its
  originating template). If a policy has no rules expanded (shouldn't happen
  with `expand=rules`, but don't assume), show `—` rather than omitting the
  row.

If the response has no items (an empty or `null` `items` array), reply with
**one line instead of an empty table**:

> No AI Catalog policies apply to project `<PROJECT>`.

**This single line also covers the case where the caller isn't authorized to
see the project's policies** — the backend returns the identical empty shape
for "nothing here" and "you can't see this," and there is no non-admin way to
tell them apart (the same limitation already noted for project-key
validation in `../SKILL.md`). Do not guess at a more specific reason; do not
imply the project has no policies as a matter of fact if the caller might
simply lack visibility.

## Gotchas

- **Never call the `/ui/api/v1/...` gateway path.** That's the browser
  session's door into this service and rejects a bearer token outright. The
  path above (`/unifiedpolicy/api/v1/...`, no `/ui/api/v1` prefix) is the one
  a CLI/token caller uses — same door the waiver flow already goes through.
- **Never expose the "Unified Policy" name, the `/unifiedpolicy/...` path, or
  any other internal service detail to the user.** Present everything as an
  "AI Catalog policy" — this applies to prose, error messages, and any
  follow-up explanation, not just the response template above.
- **A policy's `mode` is independent of its rule's own allow/block
  semantics.** `mode` is the *enforcement* mode (does a match block or just
  warn); the rule's template determines *what* it matches on (an allow-list,
  a malicious-skill check, etc.). Present both — don't collapse them into one
  column.
- **Don't leak the plumbing.** Never show the user the raw `jf api` command,
  the query string, or the JSON — only the rendered table or the one-line
  fallback.
