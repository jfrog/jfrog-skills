# Examples

Forkable reference snippets that build on top of the
`jfrog-project-setup` apply scripts. **The agent does not run anything
in this directory automatically.** It points users at the relevant
example when their intent matches; the customer copies the example
into their own onboarding repo and adapts it.

The `scripts/` directory next door holds first-class apply scripts the
agent invokes. This `examples/` directory holds patterns customers
own — keeping the two separate is intentional, so that customer-facing
glue can evolve at customer pace without affecting the skill's
mutation surface.

## Why this directory exists (the scaling story)

The interactive `jfrog-project-setup` flow is sized for the **first
project of a given shape**: the agent walks the Platform Admin or
Project Admin through Phase 1+2 (project entity + identity & access)
and Phase 3+4 (repositories + sharing) questions, customises a
starting template, and pipes the result to the apply scripts.

That's roughly thirty minutes of conversation. It's the right
investment exactly once per project archetype.

For project N+1 of the same shape — onboarding the next team, the
next budget ID, the next application — re-running the AI flow is
overkill. The customer already knows the answers; they just need a
new key, a new display name, and (for OIDC) a new source repo. That
is what the example here automates.

## What ships here

| File | Use when |
| --- | --- |
| `onboard-from-base.sh` | The user wants to replicate an existing project's shape into a new project. Fetches the existing template, substitutes the project key (plus display name and optional OIDC source repo), and pipes the rendered JSON to both apply scripts. |

## The "house template" pattern this example assumes

The example expects the org to keep one or more **house templates**
in the Artifactory templates repo (see
[`../../jfrog/references/project-templates-artifactory-repo.md`](../../jfrog/references/project-templates-artifactory-repo.md)).
A house template is just a customised project template — typically
the first project of a given archetype, reviewed and committed back
to the templates repo as the canonical shape.

```
project-templates-generic-local/
   team-default.json            # bundled archetype (or your variant)
   acme-finance-house.json      # your "house template" for finance projects
   acme-app-house.json          # your "house template" for application projects
   fin-1042.json                # per-project: explicit shape for fin-1042
   fin-1043.json                # per-project: written by `onboard-from-base.sh --render-only`
   applied/                     # opt-in audit trail (--audit on apply scripts)
```

Subsequent onboards run the envelope against the matching house
template, and (optionally) write the rendered output back to the
per-project tier (`<key>.json`) so the AI flow finds the exact shape
on its next visit to that project.

## What the envelope does

For every string in the base template that contains the old
`project.key` as a whole word, `onboard-from-base.sh` substitutes the
new key. This covers, in a typical template:

1. `project.key` itself.
2. Group names that contain the key by convention
   (`<key>-developers`, `<key>-release`, `<key>-security`,
   `<key>-leads`, etc., depending on the org's naming).
3. The OIDC provider `name` (e.g. `<key>-gha`).
4. The `applied-permissions/groups:<key>-...` scope strings inside
   OIDC `token_spec.scope`.

It then applies two targeted overrides:

5. `project.display_name` = the value passed to `--display`.
6. If the template has an `oidc.identity_mappings[]` array and
   `--source-repo` was set, every `claims.repository` is overridden
   with the new value.

Word-boundary substitution prevents collisions: a key like `fin`
does **not** match inside `final` or `finalise`, and a key like
`team` does **not** match inside `teams` or `teamwork`. The
project-key regex (`^[a-z][a-z0-9-]{0,30}[a-z0-9]$`) and JFrog's
own immutable-key rule make it easy to pick keys that are
unambiguous enough that word-boundary substitution is always safe.

## Worked example: `fin-1042` → `fin-1043`

Assume the templates repo holds the curated shape for the finance
1042 project at
`/artifactory/project-templates-generic-local/fin-1042.json`. To
onboard finance 1043 with the same shape:

```bash
./onboard-from-base.sh \
  --base-url /artifactory/project-templates-generic-local/fin-1042.json \
  --key fin-1043 \
  --display "Finance Platform 1043" \
  --source-repo myorg/fin-1043-app
```

What changes between the two rendered templates:

| Field in `fin-1042.json` | Field in `fin-1043.json` (rendered) |
| --- | --- |
| `project.key`: `"fin-1042"` | `"fin-1043"` |
| `project.display_name`: `"Finance Platform 1042"` | `"Finance Platform 1043"` |
| `admins.groups`: `["fin-1042-admins"]` | `["fin-1043-admins"]` |
| `members[*].group`: `"fin-1042-..."` | `"fin-1043-..."` |
| `oidc.provider.name`: `"fin-1042-gha"` | `"fin-1043-gha"` |
| `oidc.identity_mappings[*].claims.repository`: `"myorg/fin-1042-app"` | `"myorg/fin-1043-app"` |
| `oidc.identity_mappings[*].token_spec.scope`: `"applied-permissions/groups:fin-1042-..."` | `"applied-permissions/groups:fin-1043-..."` |

Everything else — role split, OIDC `provider_type` and `audience`,
identity-mapping `priority` and `expires_in`, the SDLC stages, the
four-part repository convention, the virtual aggregator order, the
External-stage RBAC overlay, the producer/consumer sharing pattern —
carries over unchanged.

A reviewer comparing `fin-1042.json` against the rendered
`fin-1043.json` in a PR diff sees only the intentional, instance-
specific changes.

## Common variations

### Review the rendered template before applying

```bash
./onboard-from-base.sh \
  --base-url /artifactory/.../fin-1042.json \
  --key fin-1043 --display "Finance Platform 1043" \
  --source-repo myorg/fin-1043-app \
  --render-only > fin-1043.json
```

The script writes the rendered template to stdout and exits without
invoking the apply scripts. Review it, attach to a PR, then apply by
piping it back in via either apply script directly.

### Seed the templates repo with the per-project tier

```bash
./onboard-from-base.sh \
  --base-url /artifactory/<repo>/fin-1042.json \
  --key fin-1043 --display "..." --source-repo "..." \
  --render-only \
  | jf api /artifactory/<repo>/fin-1043.json -X PUT \
      -H "Content-Type: application/json" --input -
```

Subsequent agent conversations that mention `fin-1043` will then
discover the per-project template at tier 1 of the fetch chain (see
`../../jfrog/references/project-templates-artifactory-repo.md`).

### Dry-run before applying

```bash
./onboard-from-base.sh ... --dry-run
```

Passes `--dry-run` through to both apply scripts, so they emit
"would create / would update" outcome JSON without touching the
platform.

### Apply only Phase 1+2

```bash
./onboard-from-base.sh ... --skip-phase-3-4
```

Useful when the customer wants to land the project entity, members,
and OIDC right away and configure repositories interactively later
through the AI flow.

### Read from a local file instead of Artifactory

```bash
cat ./local/fin-1042.json | ./onboard-from-base.sh \
  --from-stdin --key fin-1043 --display "..." --source-repo "..."
```

## When to use the AI flow instead

Run the `jfrog-project-setup` skill conversation (and not this
envelope) when:

- This is the **first project of a new archetype** — the org does not
  yet have a curated template to copy from.
- The new project should **deviate** materially from any existing one
  (different stage names, different technologies, different sharing
  pattern, different OIDC provider).
- The customer wants the agent to **review existing groups, OIDC
  providers, and project keys** on the platform before settling on
  the new values.

## Fork checklist

Copy `onboard-from-base.sh` into your own onboarding repo
(`cp onboard-from-base.sh <your-repo>/onboarding/`), then review:

- **Key-naming convention.** The script's substitution assumes group
  names, OIDC provider names, and OIDC scopes that all contain the
  project key as a whole word. If your org uses a different
  convention (`<key>_admins` with an underscore, or a separate
  identifier embedded in each group name), extend the substitution
  filter in the script.
- **Source-repo convention.** The script overrides every
  `claims.repository` to the same value. If your OIDC mappings point
  at multiple source repos per project, replace the single
  `--source-repo` flag with one flag per mapping, or read a
  parameters file.
- **CI integration.** Wire the script into your CI of choice — a
  GitHub Actions `workflow_dispatch` with `key`, `display`, and
  `source-repo` inputs is the most common shape. The script's
  rendered output and outcome JSON are stable enough to attach to
  PR comments verbatim.
- **Audit destination.** `--audit` writes to
  `/artifactory/<templates-repo>/applied/<key>-<ts>.json` by default.
  If your org needs a different audit destination, post-process the
  apply scripts' outcome JSON rather than editing the apply scripts
  themselves.

## Anti-patterns

- **Do not** edit the bundled blueprints under
  `../../jfrog/assets/project-templates/`. Customise via your
  Artifactory templates repo instead. The bundled blueprints stay
  frozen as last-resort fallbacks.
- **Do not** add platform writes to this envelope beyond what the
  apply scripts already do. The two apply scripts are the only
  mutators; this envelope is a thin renderer + invoker.
- **Do not** embed credentials in templates. Templates describe
  project shape only; auth is handled by `jf config` plus OIDC.
