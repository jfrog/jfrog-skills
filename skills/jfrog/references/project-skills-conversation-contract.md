# Project skills — conversation contract

Used by [`jfrog-project-setup`](../../jfrog-project-setup/SKILL.md)
across both phase groups (Phase 1+2 creation and Phase 3+4
repo-structure). The per-phase flow docs (`creation-flow.md`,
`repo-structure-flow.md`) cover the *phase-specific* stages
(2-4); the patterns documented below are identical between the
two phase groups and are referenced from each flow's final stages.

For the per-resource state machine, outcome JSON shape, recovery
patterns, `--audit` contract, and shared gotchas, see
[`projects-verification-contract.md`](projects-verification-contract.md).

## Preview pattern (final question stage)

After Phase 1+2 (creation) or Phase 3+4 (repo-structure)
customisation, render the customised JSON inline as a single
fenced ```json block. **Do not write it to disk yet.** Ask:

> "Apply this to `<server-id>` now? Reply `yes` to pipe it to the
> apply script, or tell me what to change."

If the user requests changes, return to the appropriate stage and
iterate until the user approves.

The repo-structure preview MAY omit the project-entity sections
(`project`, `admins`, `members`, `oidc`) to focus on what changed;
the creation preview shows the full template.

## Pipe-to-apply pattern

When the user approves:

1. **Validate offline first** (optional but recommended):

   ```bash
   echo "$CUSTOMISED_JSON" \
     | bash <skill_path>/scripts/<validate-script>.sh
   ```

2. **Apply**:

   ```bash
   echo "$CUSTOMISED_JSON" \
     | bash <skill_path>/scripts/<apply-script>.sh \
         --server-id "$SERVER_ID"
   ```

   Construct the command in a single Shell call so the JSON does
   not have to live in a temp file.

3. **Capture the outcome JSON** printed on stdout. Re-read the
   captured value instead of re-running the script.
4. **Run post-apply checks** per the *Post-apply checks*
   subsection in the skill's `SKILL.md`. For the per-resource
   state machine and recovery patterns, see
   [`projects-verification-contract.md`](projects-verification-contract.md).
5. **Summarise to the user**: per-resource status from the outcome
   JSON (`created`, `updated`, `already_exists`, `skipped` with
   reason, or `errored`).

## Re-applying after a failure

The apply scripts are idempotent. If a resource errors:

1. Show the user the error from the outcome JSON.
2. Fix the input — e.g. a missing group on the platform: the user
   creates the group, or the agent edits the customised JSON to
   drop the group reference.
3. Re-pipe the corrected JSON to the apply script. Resources that
   succeeded the first time report `already_exists` on the rerun.

The agent never deletes or recreates resources to "clean up" a
partial apply. The apply script refuses destructive operations
(re-creating an existing `project_key`, renaming repos, deleting
unmanaged shares); the agent must surface those refusals verbatim.

## Audit trail (opt-in)

Pass `--audit` to the apply script when the user wants every
applied template archived in Artifactory:

```bash
echo "$CUSTOMISED_JSON" \
  | bash <skill_path>/scripts/<apply-script>.sh \
      --server-id "$SERVER_ID" --audit
```

After a successful apply, the script PUTs a copy of the input
through the platform:

```text
/artifactory/<templates-repo>/applied/<project_key>-<iso8601>.json
```

For the Phase 3+4 (repo-structure) script the suffix is
`-repos-<iso8601>.json` to avoid colliding with Phase 1+2
(creation) audit records.

No local file write is involved. Audit upload failures are
warnings, not errors. See
[`projects-verification-contract.md`](projects-verification-contract.md)
§*Shared gotchas* for the `--audit` cross-skill behaviour.

## What these flows do not do

- Do not write any file to local disk. Customised JSON lives in
  the agent's context window between fetch and apply.
- Do not probe the caller's role before starting. Permission
  errors come from the platform and are surfaced verbatim.
- Do not create the templates repo on the user's behalf. If the
  conventional repo is missing and no env var is set, the agent
  uses the bundled blueprints.
- Do not orchestrate API calls by hand. The apply script is the
  authoritative mutator.
