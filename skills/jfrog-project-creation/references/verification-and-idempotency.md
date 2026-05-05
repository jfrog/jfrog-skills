# Verification and idempotency

The apply script's contract and the post-apply checks the agent runs.

## Idempotency contract

Both `jfrog-project-create-from-template.sh` and
`jfrog-project-validate-template.sh` follow the same rule: **read before
write**. Every resource the apply script touches is first fetched via
`GET`, compared to the desired state from the template, and only then
created or updated. This makes the scripts safe to re-run after a partial
failure.

The contract per resource type:

- **Project** (`/access/api/v1/projects/<key>`)
  - `404` → `POST /projects` to create. Outcome: `created`.
  - `200` and same `display_name`, `description`, `quota_gb`,
    `admin_privileges` → outcome: `already_exists`.
  - `200` but mutable fields differ → `PUT /projects/<key>` to update.
    Outcome: `updated`.
  - `200` but `project_key` mismatch (impossible by URL but checked
    against the template) → outcome: `skipped` with `error: key_mismatch`.
    The script never deletes a project to recreate it.

- **Custom roles** (`/access/api/v1/projects/<key>/roles/<name>`)
  - `404` → `POST` to create. Outcome: `created`.
  - `200` and same `environments` + `actions` → `already_exists`.
  - `200` but differs → `PUT` to update. Outcome: `updated`.
  - `type: PREDEFINED` entries are skipped at this step (the predefined
    role definitions are platform-supplied; the script only ensures the
    member assignment uses them). Outcome: `skipped` with
    `note: predefined`.

- **Members** (users: `/access/api/v1/projects/<key>/users/<u>`; groups:
  `/access/api/v1/projects/<key>/groups/<g>`)
  - `404` → `PUT` to create the assignment. Outcome: `created`.
  - `200` and same `roles[]` → `already_exists`.
  - `200` but `roles[]` differs → `PUT` to update. Outcome: `updated`.
  - Group/user does not exist on the platform → `skipped` with
    `error: principal_missing`. The script does not create users or
    groups; missing principals are surfaced for the operator to fix.

- **OIDC provider** (`/access/api/v1/oidc/<name>`)
  - `404` → `POST` to create. Outcome: `created`.
  - `200` and same `issuer_url`, `provider_type`, `audience` →
    `already_exists`.
  - `200` but differs → `PUT`. Outcome: `updated`.

- **OIDC identity mappings**
  (`/access/api/v1/oidc/<provider>/identity_mappings/<mapping>`)
  - `404` → `POST` to create. Outcome: `created`.
  - `200` and same `claims` + `token_spec` + `priority` →
    `already_exists`.
  - `200` but differs → `PUT`. Outcome: `updated`.
  - Note: the script never deletes mappings the template does not
    mention. Removing a mapping requires an explicit operator action,
    not a template diff.

## Outcome JSON

The apply script writes a single JSON document to stdout summarising every
action. Schema:

```json
{
  "template_path": "./projects/team-x.json",
  "template_version": "1.0",
  "blueprint": "team-default",
  "server_id": "default",
  "started_at": "2026-05-04T10:23:01Z",
  "finished_at": "2026-05-04T10:23:14Z",
  "summary": {
    "created": 5,
    "updated": 0,
    "already_exists": 0,
    "skipped": 1,
    "errored": 0
  },
  "resources": [
    {
      "kind": "project",
      "id": "team-x",
      "outcome": "created",
      "http_status": 201
    },
    {
      "kind": "role",
      "id": "Developer",
      "outcome": "skipped",
      "note": "predefined"
    },
    {
      "kind": "member.group",
      "id": "team-x-devs",
      "outcome": "created",
      "http_status": 200
    }
  ],
  "warnings": [],
  "errors": []
}
```

Capture this output to a temp file per the base SKILL.md *Preserving
command output* pattern; do not re-run the script just to re-read its
output.

## Post-apply checks

After the apply script returns success (exit 0), the agent runs the
following checks before declaring done. Each check is a single `jf api`
call; batch them in a single Shell invocation for parallelism.

### 1. Project exists with the expected shape

```bash
jf api /access/api/v1/projects/<key> > /tmp/check-project-$$.json
```

Diff key fields against the template:

```bash
jq -r '
  [
    if .display_name == "<expected>" then null else "display_name mismatch" end,
    if .description == "<expected>" then null else "description mismatch" end,
    if .admin_privileges.manage_members == <expected> then null else "manage_members mismatch" end
  ] | map(select(. != null)) | .[]
' /tmp/check-project-$$.json
```

Empty output → all expectations met. Any line → surface as a warning to
the user.

### 2. Members are assigned

```bash
jf api /access/api/v1/projects/<key>/users  > /tmp/check-users-$$.json
jf api /access/api/v1/projects/<key>/groups > /tmp/check-groups-$$.json
```

For each `(principal, roles)` in the template, confirm the principal
appears in the appropriate file with the expected `roles[]`. The groups
endpoint may return entries under `members`, `groups`, or both depending
on platform version — accept whichever is present.

### 3. Roles include the expected set

```bash
jf api /access/api/v1/projects/<key>/roles > /tmp/check-roles-$$.json
```

Confirm every template role name appears with the expected `type` and,
for CUSTOM roles, the expected `environments` and `actions`.

### 4. OIDC wiring (only if `oidc` was in the template)

```bash
jf api /access/api/v1/oidc/<provider-name> > /tmp/check-oidc-provider-$$.json
jf api /access/api/v1/oidc/<provider-name>/identity_mappings \
  > /tmp/check-oidc-mappings-$$.json
```

For each mapping in the template, confirm there is a returned mapping
with the same `name`, `claims`, and `token_spec.scope`. Priority and
`expires_in` should match exactly.

### 5. Repositories list is empty (sanity check)

```bash
jf api "/artifactory/api/repositories?project=<key>" \
  > /tmp/check-repos-$$.json
```

This skill does not create repositories; the file should hold `[]`. A
non-empty response here means another tool or a manual operator created
repos already — surface that as informational.

## Warnings vs errors in the report

The agent should treat outcomes as follows:

- `created`, `updated`, `already_exists` — success, no action.
- `skipped` with `note: predefined` — informational, no action.
- `skipped` with `error: principal_missing` — **warning**. Tell the user
  the group/user does not exist and point them at
  `../../jfrog/references/platform-admin-api-gaps.md` §Users or §Groups
  to create it; then re-running apply will pick up the now-existing
  principal.
- `skipped` with `error: key_mismatch` — **error**. Surface and stop.
- `errored` — **error**. Show the HTTP status and body from the report
  and stop.

## Re-running after partial failure

If apply fails partway through:

1. Read the `resources[]` array in the outcome JSON to see exactly which
   resources were created vs missed.
2. Fix the underlying cause (most often a missing group, or insufficient
   permissions to create OIDC mappings).
3. Re-run the apply script with the same template. Already-created
   resources will be reported as `already_exists`; missing resources
   will be created on the second pass.

Never edit the template between re-runs to "skip" already-created
resources — let the script handle it. Templates are checked into the
user's repo and represent intent, not partial state.
