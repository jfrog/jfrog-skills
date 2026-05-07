# Verification and idempotency (Phase 3+4)

The apply script's contract for repository structure and sharing, plus
the post-apply checks the agent runs. Mirrors the Phase 1+2 contract
in
[`../../jfrog-project-creation/references/verification-and-idempotency.md`](../../jfrog-project-creation/references/verification-and-idempotency.md);
read that first if you haven't seen the model yet.

## Idempotency contract

Both
[`jfrog-project-apply-repo-structure.sh`](../scripts/jfrog-project-apply-repo-structure.sh)
and
[`jfrog-project-validate-repo-structure.sh`](../scripts/jfrog-project-validate-repo-structure.sh)
follow the same rule as Phase 1+2: **read before write**. Every
resource the apply script touches is first fetched via `GET`,
compared to the desired state from the template, and only then
created or updated. This makes the scripts safe to re-run after a
partial failure.

The contract per resource type:

- **Project environments** (`/access/api/v1/projects/<key>/environments`)
  - GET project environment list. For each stage in `stages[]`:
    - Already present → `already_exists`.
    - Absent → `POST` to create. Outcome: `created`.
  - The script never removes environments the template doesn't list
    (additive only).

- **Local repositories**
  (`/artifactory/api/repositories/<key>`)
  - `404` → `PUT` to create with the derived 4-part name (or
    `name_override`), `packageType` from `tech`, `repoLayout` per
    Artifactory defaults, `projectKey` set to the project. Outcome:
    `created`.
  - `200` and matching config (`packageType`, `projectKey`) →
    `already_exists`.
  - `200` and `projectKey` differs → `skipped` with
    `error: project_assignment_conflict`. The script never reassigns
    a repo away from its current project.
  - `200` and `packageType` differs (genuine drift) → logged as
    `error: tech_drift` and skipped. Renames or repackages must be
    done out-of-band.

- **Remote repositories**
  - Same as local, with two extras: `url` must match the template's
    canonical upstream; `repoType: "remote"`.
  - `200` and `url` differs → `PUT` to update. Outcome: `updated`.

- **Virtual repositories**
  - `404` → `PUT` to create with `repositories[]` set explicitly per
    `resolution_order`. Outcome: `created`.
  - `200` and `repositories[]` matches the template's
    `resolution_order` (after expansion to full repo names) →
    `already_exists`.
  - `200` and differs → `PUT` to overwrite `repositories[]` with the
    template's order. Outcome: `updated`. **The script always rewrites
    `repositories[]` from `resolution_order` — insertion order on the
    server is never preserved.**

- **Project assignment of a repo**
  (`POST /artifactory/api/repositories/<key>` with `{"projectKey": "<key>"}`)
  - Only POSTed when the GET in the local/remote/virtual step shows a
    different or missing `projectKey`. Avoids redundant POSTs that
    would otherwise cause noisy audit events.

- **External-stage RBAC** (project member roles)
  - For each `(role, actions[])` entry in `external_stage_rbac`: GET
    the role's current actions on the External environment via
    `/access/api/v1/projects/<key>/roles/<role>`. If actions match,
    `already_exists`. If differ, PUT to update with the union of
    existing internal-stage actions plus the new External-stage
    actions. Outcome: `updated`.
  - **Additive only.** Roles not listed in `external_stage_rbac` are
    not touched. Actions not listed for a role are not removed.
  - Unknown action tokens (per the live action vocabulary) → logged
    with `error: unknown_action` for that role; the rest of the
    role's actions still apply.

- **Sharing — producer side**
  (`/access/api/v1/projects/<producer-key>/share/repos`)
  - GET the current share state for the repo. For each consumer
    project in the template's `consumer_projects[]`:
    - Already shared with that consumer → `already_exists`.
    - Not shared → `POST` to add. Outcome: `created`.
  - Refuses to remove consumers from the existing share list (additive
    only).
  - If the producer doesn't own the repo (repo's `projectKey` !=
    template's `project.key`) → `error: not_producer`.
  - If the resolved share grant would include any write action →
    `error: writer_grant_cross_project`.
  - If a target consumer project doesn't exist on the platform →
    `error: principal_missing`.

- **Sharing — consumer-side direct**
  - Resolve the consumer-side virtual aggregator (matching tech).
  - GET the producer repo's share list. If the consumer project is
    not on it, `error: not_shared_with_consumer` and skip.
  - GET the consumer-side virtual's `repositories[]`. If the producer
    repo is already in the list, `already_exists`. Otherwise, append
    after the External-stage entry and `PUT` the virtual's
    `repositories[]` with the explicit order from the template.

- **Sharing — consumer-side smart-remote**
  - Derive the upstream URL from the active server URL +
    `/artifactory/<from_repository>/`.
  - GET the consumer-side smart remote (`into_repository`). If absent,
    `PUT` to create with `repoType: "remote"`, the derived URL, the
    matching `packageType`, the consumer project's machine identity
    for upstream auth, and `projectKey: <consumer-key>`. Outcome:
    `created`.
  - If present and matching, `already_exists`. If present and differs,
    `PUT` to update. Outcome: `updated`.
  - Then: ensure the consumer-side virtual references this smart
    remote, same as the direct case but appending the smart remote
    after External entries.

## Outcome JSON

Same shape as Phase 1+2:

```json
{
  "applied_at": "2026-05-04T12:00:00Z",
  "server_id": "<id>",
  "project_key": "<key>",
  "template_path": "<path>",
  "actions": [
    {
      "resource": "repository:team-x-maven-prod-local",
      "action": "created",
      "before": null,
      "after": { "key": "team-x-maven-prod-local", "type": "local",
                 "packageType": "maven", "projectKey": "team-x" },
      "error": null
    },
    {
      "resource": "virtual:team-x-maven-all-virtual",
      "action": "updated",
      "before": { "repositories": ["team-x-maven-dev-local"] },
      "after":  { "repositories": ["team-x-maven-prod-local",
                                    "team-x-maven-dev-local",
                                    "team-x-maven-external-remote"] },
      "error": null
    },
    {
      "resource": "sharing:producer:team-x-maven-prod-local→team-y",
      "action": "skipped",
      "before": null,
      "after":  null,
      "error": "principal_missing: consumer project 'team-y' does not exist"
    }
  ],
  "summary": {
    "created": 12, "already_exists": 4, "updated": 1,
    "skipped": 1, "errored": 0
  }
}
```

The agent re-reads this file rather than rerunning the script. Treat
`errored` and `skipped-with-error` as items to surface to the user;
treat `already_exists` as silent success.

## Post-apply checks

Run these read-only checks after the apply script returns. They are
the agent's contract that the platform state matches the template.

### Check 1 — Stages exist as project environments

```bash
jf api "/access/api/v1/projects/<key>/environments" --server-id <id> > /tmp/jf-envs-$$.json
jq -r '.[] | .name' /tmp/jf-envs-$$.json | sort > /tmp/jf-envs-actual-$$.txt
jq -r '.stages[]' <template> | sort > /tmp/jf-envs-want-$$.txt
diff /tmp/jf-envs-want-$$.txt /tmp/jf-envs-actual-$$.txt
```

Empty diff → check passes. Any line in want-but-not-actual is a
failure to surface.

### Check 2 — Every repository in template exists with correct project assignment

```bash
jf api "/artifactory/api/repositories?project=<key>" --server-id <id> \
  > /tmp/jf-repos-$$.json
echo /tmp/jf-repos-$$.json
```

For each entry in the template's `repositories[]`, derive the 4-part
name (or use `name_override`) and check it appears in the response
with the right `type` and `packageType`. Any mismatch is a failure.

### Check 3 — Virtual aggregators have the correct resolution order

For each virtual entry in the template:

```bash
jf api "/artifactory/api/repositories/<virtual-name>" --server-id <id> > /tmp/jf-virt-$$.json
jq -r '.repositories[]' /tmp/jf-virt-$$.json
```

Compare to the expanded `resolution_order[]` from the template. The
two lists must match position-for-position.

### Check 4 — Sharing entries reflect the template

For each `producer` entry: GET the share list for the producer repo
and verify each `consumer_projects[]` is present.

For each `consumer/direct` entry: GET the consumer-side virtual and
verify the producer repo is in `repositories[]`.

For each `consumer/smart-remote` entry: GET the consumer-side smart
remote and verify it exists, points at the producer URL, and is
referenced from the consumer-side virtual.

### Check 5 — External-stage RBAC matches template

For each role in `external_stage_rbac`:

```bash
jf api "/access/api/v1/projects/<key>/roles/<role>" --server-id <id> > /tmp/jf-role-$$.json
```

Verify the role's actions on the External environment include the set
declared in the template (additive: extra actions are OK; missing
actions are a failure).

## Errors vs warnings

- `error: principal_missing` (consumer project not on platform) and
  `error: not_shared_with_consumer` (producer hasn't shared yet) are
  treated as *warnings* in the conversation: surface but don't block
  the rest of the apply.
- `error: writer_grant_cross_project` is treated as a *fix-the-template*
  failure: the offending sharing entry is skipped and the user must
  edit the template before re-running.
- `error: project_assignment_conflict` is also fix-the-template: the
  user must rename the repo (out-of-band) or use a different `tech`
  combination.
- All other errors are infrastructure-level (network, 5xx) and the
  agent should retry the script unchanged before bothering the user.
