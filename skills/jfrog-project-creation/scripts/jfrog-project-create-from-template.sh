#!/usr/bin/env bash
# jfrog-project-create-from-template.sh — Apply a JFrog Project template idempotently.
#
# Reads a Phase 1+2 project template (see assets/project-templates/schema.json
# in the base jfrog skill), reconciles each resource with the JFrog Platform
# using GET-before-PUT/POST, and emits a structured JSON outcome report on
# stdout. Safe to re-run after partial failure.
#
# All API calls go through `jf api` against the resolved server. Caller must
# have platform-admin scope on that server. Network permission is required
# (run via the Shell tool with required_permissions: ["full_network"]).
#
# Usage:
#   jfrog-project-create-from-template.sh <template.json> [--server-id <id>] [--dry-run]
#
# Arguments:
#   <template.json>     Path to a customised project template file
#
# Options:
#   --server-id <id>    Target a specific configured JFrog server (default: active)
#   --dry-run           Run all GETs and decision logic but skip every write.
#                       The report still reflects what would have been done.
#
# Exit codes:
#   0 — Apply succeeded (every resource is created, updated, already_exists, or skipped-with-note)
#   1 — Usage / prerequisite / template / version error (no API calls made)
#   2 — One or more resources errored. Outcome report still written; inspect it.

set -euo pipefail

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

TEMPLATE_PATH=""
SERVER_ID=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-id) SERVER_ID="${2:-}"; shift 2 ;;
    --server-id=*) SERVER_ID="${1#--server-id=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1" >&2
      exit 1
      ;;
    *)
      if [[ -z "$TEMPLATE_PATH" ]]; then
        TEMPLATE_PATH="$1"; shift
      else
        echo "ERROR: unexpected positional argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$TEMPLATE_PATH" ]]; then
  echo "Usage: $0 <template.json> [--server-id <id>] [--dry-run]" >&2
  exit 1
fi

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "ERROR: template file not found: $TEMPLATE_PATH" >&2
  exit 1
fi

for cmd in jq jf; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: ${cmd} is not installed on PATH" >&2
    exit 1
  fi
done

if ! jq -e . "$TEMPLATE_PATH" >/dev/null 2>&1; then
  echo "ERROR: template is not valid JSON: $TEMPLATE_PATH" >&2
  exit 1
fi

TPL_VERSION=$(jq -r '.template_version // empty' "$TEMPLATE_PATH")
if [[ -z "$TPL_VERSION" ]]; then
  echo "ERROR: template_version missing in $TEMPLATE_PATH" >&2
  exit 1
fi
TPL_MAJOR="${TPL_VERSION%%.*}"
if [[ "$TPL_MAJOR" != "1" ]]; then
  echo "ERROR: template_version $TPL_VERSION not supported (this script handles 1.x)" >&2
  exit 1
fi

PROJECT_KEY=$(jq -r '.project.key // empty' "$TEMPLATE_PATH")
if [[ -z "$PROJECT_KEY" ]]; then
  echo "ERROR: project.key missing in template" >&2
  exit 1
fi
if ! [[ "$PROJECT_KEY" =~ ^[a-z][a-z0-9-]{0,30}[a-z0-9]$ ]]; then
  echo "ERROR: project.key '$PROJECT_KEY' violates the naming rule (2-32 chars, lowercase alphanumeric and hyphens, must start with a letter)" >&2
  exit 1
fi

SERVER_FLAG=()
if [[ -n "$SERVER_ID" ]]; then
  SERVER_FLAG=(--server-id="$SERVER_ID")
fi

# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------

WORKDIR=$(mktemp -d -t jfrog-project-apply.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT
RESOURCES_FILE="$WORKDIR/resources.ndjson"
WARNINGS_FILE="$WORKDIR/warnings.ndjson"
ERRORS_FILE="$WORKDIR/errors.ndjson"
: >"$RESOURCES_FILE" >"$WARNINGS_FILE" >"$ERRORS_FILE"

STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

http_status_of() {
  local err_file="$1"
  local line
  line=$(grep -F 'Http Status:' "$err_file" 2>/dev/null | tail -1 || true)
  if [[ "$line" =~ Http\ Status:\ ([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi
  line=$(grep -E 'returned [0-9]+' "$err_file" 2>/dev/null | tail -1 || true)
  if [[ "$line" =~ returned\ ([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi
  echo "0"
}

api_call() {
  # api_call <METHOD> <PATH> [<JSON_BODY>]
  # Sets globals: API_RC, API_STATUS, API_OUT_FILE, API_ERR_FILE
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local out err
  out=$(mktemp -p "$WORKDIR" out.XXXXXX)
  err=$(mktemp -p "$WORKDIR" err.XXXXXX)
  set +e
  if [[ -n "$body" ]]; then
    local body_file
    body_file=$(mktemp -p "$WORKDIR" body.XXXXXX)
    printf '%s' "$body" >"$body_file"
    jf api "$path" -X "$method" -H "Content-Type: application/json" \
      --input "$body_file" "${SERVER_FLAG[@]}" >"$out" 2>"$err"
  else
    jf api "$path" -X "$method" "${SERVER_FLAG[@]}" >"$out" 2>"$err"
  fi
  API_RC=$?
  set -e
  API_STATUS=$(http_status_of "$err")
  API_OUT_FILE="$out"
  API_ERR_FILE="$err"
}

record_resource() {
  # record_resource <kind> <id> <outcome> [<extra_json_object>]
  local kind="$1"
  local id="$2"
  local outcome="$3"
  local extra="${4:-{\}}"
  jq -nc \
    --arg kind "$kind" \
    --arg id "$id" \
    --arg outcome "$outcome" \
    --argjson extra "$extra" \
    '{kind:$kind, id:$id, outcome:$outcome} + $extra' \
    >>"$RESOURCES_FILE"
}

record_warning() {
  jq -nc --arg msg "$1" '{message:$msg}' >>"$WARNINGS_FILE"
}

record_error() {
  jq -nc --arg msg "$1" '{message:$msg}' >>"$ERRORS_FILE"
}

write_action() {
  # Skips actual writes when --dry-run is set; returns 0 either way.
  if (( DRY_RUN == 1 )); then
    API_RC=0
    API_STATUS=200
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# Section 1: Project entity
# ---------------------------------------------------------------------------

apply_project() {
  local key
  key="$PROJECT_KEY"

  api_call GET "/access/api/v1/projects/$key"

  # Build desired payload
  local desired
  desired=$(jq -c '
    .project as $p
    | {
        project_key: $p.key,
        display_name: $p.display_name,
        description: ($p.description // ""),
        admin_privileges: $p.admin_privileges,
        storage_quota_bytes: (
          if ($p.quota_gb // null) == null then -1
          else ($p.quota_gb * 1024 * 1024 * 1024)
          end
        )
      }
  ' "$TEMPLATE_PATH")

  if [[ "$API_STATUS" == "404" ]]; then
    if write_action; then
      record_resource project "$key" created '{"http_status": 0, "dry_run": true}'
      return 0
    fi
    api_call POST "/access/api/v1/projects" "$desired"
    if [[ "$API_RC" -eq 0 ]]; then
      record_resource project "$key" created "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber)}')"
    else
      record_resource project "$key" errored "$(jq -nc --arg s "$API_STATUS" --rawfile body "$API_OUT_FILE" '{http_status: ($s|tonumber), body: $body}')"
      record_error "Failed to create project $key (HTTP $API_STATUS)"
    fi
    return 0
  fi

  if [[ "$API_STATUS" != "200" ]]; then
    record_resource project "$key" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "lookup_failed"}')"
    record_error "Failed to look up project $key (HTTP $API_STATUS)"
    return 0
  fi

  # 200 — compare relevant fields
  local diff
  diff=$(jq -n \
    --slurpfile current "$API_OUT_FILE" \
    --argjson desired "$desired" \
    '
      ($current[0]) as $c
      | [
          if ($c.display_name // "") == $desired.display_name then null else "display_name" end,
          if ($c.description // "") == $desired.description then null else "description" end,
          if ($c.admin_privileges // {}) == $desired.admin_privileges then null else "admin_privileges" end,
          if ($c.storage_quota_bytes // -1) == $desired.storage_quota_bytes then null else "storage_quota_bytes" end
        ] | map(select(. != null))
    ')
  local diff_count
  diff_count=$(echo "$diff" | jq 'length')

  if [[ "$diff_count" -eq 0 ]]; then
    record_resource project "$key" already_exists "$(jq -nc '{http_status: 200}')"
    return 0
  fi

  # Update
  if write_action; then
    record_resource project "$key" updated "$(jq -nc --argjson d "$diff" '{http_status: 0, dry_run: true, changed_fields: $d}')"
    return 0
  fi
  local update_body
  update_body=$(jq -nc \
    --argjson desired "$desired" \
    '{display_name: $desired.display_name, description: $desired.description, admin_privileges: $desired.admin_privileges, storage_quota_bytes: $desired.storage_quota_bytes}')
  api_call PUT "/access/api/v1/projects/$key" "$update_body"
  if [[ "$API_RC" -eq 0 ]]; then
    record_resource project "$key" updated "$(jq -nc --arg s "$API_STATUS" --argjson d "$diff" '{http_status: ($s|tonumber), changed_fields: $d}')"
  else
    record_resource project "$key" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "update_failed"}')"
    record_error "Failed to update project $key (HTTP $API_STATUS)"
  fi
}

# ---------------------------------------------------------------------------
# Section 2: Roles (custom only; predefined skipped with note)
# ---------------------------------------------------------------------------

apply_roles() {
  local count
  count=$(jq '.roles // [] | length' "$TEMPLATE_PATH")
  if [[ "$count" -eq 0 ]]; then return 0; fi

  local i
  for ((i=0; i<count; i++)); do
    local role_json type name
    role_json=$(jq -c ".roles[$i]" "$TEMPLATE_PATH")
    type=$(echo "$role_json" | jq -r '.type')
    name=$(echo "$role_json" | jq -r '.name')

    if [[ "$type" == "PREDEFINED" || "$type" == "ADMIN" ]]; then
      record_resource role "$name" skipped "$(jq -nc --arg t "$type" '{note: "predefined", type: $t}')"
      continue
    fi

    # CUSTOM
    api_call GET "/access/api/v1/projects/$PROJECT_KEY/roles/$name"
    local desired_body
    desired_body=$(echo "$role_json" | jq -c '{name: .name, description: (.description // ""), type: "CUSTOM", environments: (.environments // []), actions: (.actions // [])}')

    if [[ "$API_STATUS" == "404" ]]; then
      if write_action; then
        record_resource role "$name" created '{"dry_run": true}'
        continue
      fi
      api_call POST "/access/api/v1/projects/$PROJECT_KEY/roles" "$desired_body"
      if [[ "$API_RC" -eq 0 ]]; then
        record_resource role "$name" created "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber)}')"
      else
        record_resource role "$name" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "create_failed"}')"
        record_error "Failed to create custom role $name (HTTP $API_STATUS)"
      fi
      continue
    fi

    if [[ "$API_STATUS" != "200" ]]; then
      record_resource role "$name" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "lookup_failed"}')"
      record_error "Failed to look up role $name (HTTP $API_STATUS)"
      continue
    fi

    # 200 — compare
    local diff
    diff=$(jq -n \
      --slurpfile current "$API_OUT_FILE" \
      --argjson desired "$desired_body" \
      '
        ($current[0]) as $c
        | [
            if (($c.environments // []) | sort) == (($desired.environments // []) | sort) then null else "environments" end,
            if (($c.actions      // []) | sort) == (($desired.actions      // []) | sort) then null else "actions" end,
            if ($c.description // "") == $desired.description then null else "description" end
          ] | map(select(. != null))
      ')
    local diff_count
    diff_count=$(echo "$diff" | jq 'length')

    if [[ "$diff_count" -eq 0 ]]; then
      record_resource role "$name" already_exists '{"http_status": 200}'
      continue
    fi

    if write_action; then
      record_resource role "$name" updated "$(jq -nc --argjson d "$diff" '{dry_run: true, changed_fields: $d}')"
      continue
    fi
    api_call PUT "/access/api/v1/projects/$PROJECT_KEY/roles/$name" "$desired_body"
    if [[ "$API_RC" -eq 0 ]]; then
      record_resource role "$name" updated "$(jq -nc --arg s "$API_STATUS" --argjson d "$diff" '{http_status: ($s|tonumber), changed_fields: $d}')"
    else
      record_resource role "$name" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "update_failed"}')"
      record_error "Failed to update custom role $name (HTTP $API_STATUS)"
    fi
  done
}

# ---------------------------------------------------------------------------
# Section 3: Members (admins + members)
# ---------------------------------------------------------------------------

# Build a unified principals list: each item has kind (user|group), name, roles[].
# Project Admin assignments come from .admins; ordinary roles from .members.
build_principals_file() {
  local f="$WORKDIR/principals.ndjson"
  : >"$f"
  jq -c '
    [
      ((.admins.users  // []) | map({kind:"user",  name:., roles:["Project Admin"]})),
      ((.admins.groups // []) | map({kind:"group", name:., roles:["Project Admin"]})),
      ((.members // []) | map(
        if has("user")  then {kind:"user",  name:.user,  roles:.roles}
        elif has("group") then {kind:"group", name:.group, roles:.roles}
        else empty end))
    ]
    | add
    # Merge by (kind,name) so a principal listed in both admins and members
    # ends up with the union of roles.
    | group_by([.kind, .name])
    | map({kind: .[0].kind, name: .[0].name, roles: ([.[].roles[]] | unique)})
    | .[]
  ' "$TEMPLATE_PATH" >"$f"
  echo "$f"
}

# Confirm a platform-level group/user exists. Returns 0 if found, 1 if 404, 2 on other error.
principal_exists() {
  local kind="$1"
  local name="$2"
  local path
  if [[ "$kind" == "group" ]]; then
    path="/access/api/v2/groups/$name"
  else
    path="/access/api/v2/users/$name"
  fi
  api_call GET "$path"
  case "$API_STATUS" in
    200) return 0 ;;
    404) return 1 ;;
    *)   return 2 ;;
  esac
}

apply_members() {
  local pfile
  pfile=$(build_principals_file)
  local total
  total=$(wc -l <"$pfile" | tr -d ' ')
  if [[ "$total" -eq 0 ]]; then return 0; fi

  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    local kind name roles_json
    kind=$(echo "$entry" | jq -r '.kind')
    name=$(echo "$entry" | jq -r '.name')
    roles_json=$(echo "$entry" | jq -c '.roles')

    local rkind="member.$kind"

    if ! principal_exists "$kind" "$name"; then
      record_resource "$rkind" "$name" skipped "$(jq -nc --arg p "$kind" '{error: "principal_missing", principal_kind: $p}')"
      record_warning "$kind '$name' does not exist on the platform; project membership skipped. Create the $kind first, then re-run apply."
      continue
    fi

    local proj_path
    if [[ "$kind" == "group" ]]; then
      proj_path="/access/api/v1/projects/$PROJECT_KEY/groups/$name"
    else
      proj_path="/access/api/v1/projects/$PROJECT_KEY/users/$name"
    fi

    api_call GET "$proj_path"
    local body
    body=$(jq -nc --arg n "$name" --argjson r "$roles_json" '{name:$n, roles:$r}')

    if [[ "$API_STATUS" == "404" ]]; then
      if write_action; then
        record_resource "$rkind" "$name" created '{"dry_run": true}'
        continue
      fi
      api_call PUT "$proj_path" "$body"
      if [[ "$API_RC" -eq 0 ]]; then
        record_resource "$rkind" "$name" created "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber)}')"
      else
        record_resource "$rkind" "$name" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "assign_failed"}')"
        record_error "Failed to assign $kind $name to project $PROJECT_KEY (HTTP $API_STATUS)"
      fi
      continue
    fi

    if [[ "$API_STATUS" != "200" ]]; then
      record_resource "$rkind" "$name" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "lookup_failed"}')"
      record_error "Failed to look up project $kind $name (HTTP $API_STATUS)"
      continue
    fi

    local current_roles same
    current_roles=$(jq -c '.roles // []' "$API_OUT_FILE")
    same=$(jq -n --argjson a "$current_roles" --argjson b "$roles_json" '($a|sort) == ($b|sort)')
    if [[ "$same" == "true" ]]; then
      record_resource "$rkind" "$name" already_exists '{"http_status": 200}'
      continue
    fi

    if write_action; then
      record_resource "$rkind" "$name" updated "$(jq -nc --argjson r "$roles_json" '{dry_run: true, desired_roles: $r}')"
      continue
    fi
    api_call PUT "$proj_path" "$body"
    if [[ "$API_RC" -eq 0 ]]; then
      record_resource "$rkind" "$name" updated "$(jq -nc --arg s "$API_STATUS" --argjson r "$roles_json" '{http_status: ($s|tonumber), desired_roles: $r}')"
    else
      record_resource "$rkind" "$name" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "update_failed"}')"
      record_error "Failed to update $kind $name on project $PROJECT_KEY (HTTP $API_STATUS)"
    fi
  done <"$pfile"
}

# ---------------------------------------------------------------------------
# Section 4: OIDC provider + identity mappings
# ---------------------------------------------------------------------------

apply_oidc() {
  local has_oidc
  has_oidc=$(jq 'has("oidc") and (.oidc != null)' "$TEMPLATE_PATH")
  if [[ "$has_oidc" != "true" ]]; then return 0; fi

  local provider_name
  provider_name=$(jq -r '.oidc.provider.name' "$TEMPLATE_PATH")

  # Provider
  api_call GET "/access/api/v1/oidc/$provider_name"
  local desired_provider
  desired_provider=$(jq -c '.oidc.provider | {name, issuer_url, provider_type, audience: (.audience // ""), description: (.description // "")}' "$TEMPLATE_PATH")

  if [[ "$API_STATUS" == "404" ]]; then
    if write_action; then
      record_resource oidc.provider "$provider_name" created '{"dry_run": true}'
    else
      api_call POST "/access/api/v1/oidc" "$desired_provider"
      if [[ "$API_RC" -eq 0 ]]; then
        record_resource oidc.provider "$provider_name" created "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber)}')"
      else
        record_resource oidc.provider "$provider_name" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "create_failed"}')"
        record_error "Failed to create OIDC provider $provider_name (HTTP $API_STATUS)"
        return 0
      fi
    fi
  elif [[ "$API_STATUS" == "200" ]]; then
    local diff diff_count
    diff=$(jq -n --slurpfile c "$API_OUT_FILE" --argjson d "$desired_provider" '
      ($c[0]) as $c
      | [
          if ($c.issuer_url // "") == $d.issuer_url then null else "issuer_url" end,
          if ($c.provider_type // "") == $d.provider_type then null else "provider_type" end,
          if ($c.audience // "") == $d.audience then null else "audience" end
        ] | map(select(. != null))
    ')
    diff_count=$(echo "$diff" | jq 'length')
    if [[ "$diff_count" -eq 0 ]]; then
      record_resource oidc.provider "$provider_name" already_exists '{"http_status": 200}'
    else
      if write_action; then
        record_resource oidc.provider "$provider_name" updated "$(jq -nc --argjson d "$diff" '{dry_run: true, changed_fields: $d}')"
      else
        api_call PUT "/access/api/v1/oidc/$provider_name" "$desired_provider"
        if [[ "$API_RC" -eq 0 ]]; then
          record_resource oidc.provider "$provider_name" updated "$(jq -nc --arg s "$API_STATUS" --argjson d "$diff" '{http_status: ($s|tonumber), changed_fields: $d}')"
        else
          record_resource oidc.provider "$provider_name" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "update_failed"}')"
          record_error "Failed to update OIDC provider $provider_name (HTTP $API_STATUS)"
          return 0
        fi
      fi
    fi
  else
    record_resource oidc.provider "$provider_name" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "lookup_failed"}')"
    record_error "Failed to look up OIDC provider $provider_name (HTTP $API_STATUS)"
    return 0
  fi

  # Identity mappings
  local mcount i
  mcount=$(jq '.oidc.identity_mappings // [] | length' "$TEMPLATE_PATH")
  for ((i=0; i<mcount; i++)); do
    local mjson mname desired_mapping
    mjson=$(jq -c ".oidc.identity_mappings[$i]" "$TEMPLATE_PATH")
    mname=$(echo "$mjson" | jq -r '.name')
    desired_mapping=$(echo "$mjson" | jq -c '{name, priority: (.priority // 100), description: (.description // ""), claims, token_spec}')

    api_call GET "/access/api/v1/oidc/$provider_name/identity_mappings/$mname"

    if [[ "$API_STATUS" == "404" ]]; then
      if write_action; then
        record_resource oidc.mapping "$provider_name/$mname" created '{"dry_run": true}'
      else
        api_call POST "/access/api/v1/oidc/$provider_name/identity_mappings" "$desired_mapping"
        if [[ "$API_RC" -eq 0 ]]; then
          record_resource oidc.mapping "$provider_name/$mname" created "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber)}')"
        else
          record_resource oidc.mapping "$provider_name/$mname" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "create_failed"}')"
          record_error "Failed to create OIDC mapping $provider_name/$mname (HTTP $API_STATUS)"
        fi
      fi
      continue
    fi

    if [[ "$API_STATUS" != "200" ]]; then
      record_resource oidc.mapping "$provider_name/$mname" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "lookup_failed"}')"
      record_error "Failed to look up OIDC mapping $provider_name/$mname (HTTP $API_STATUS)"
      continue
    fi

    local diff diff_count
    diff=$(jq -n --slurpfile c "$API_OUT_FILE" --argjson d "$desired_mapping" '
      ($c[0]) as $c
      | [
          if ($c.claims // {}) == $d.claims then null else "claims" end,
          if ($c.token_spec // {}) == $d.token_spec then null else "token_spec" end,
          if ($c.priority // null) == $d.priority then null else "priority" end
        ] | map(select(. != null))
    ')
    diff_count=$(echo "$diff" | jq 'length')

    if [[ "$diff_count" -eq 0 ]]; then
      record_resource oidc.mapping "$provider_name/$mname" already_exists '{"http_status": 200}'
      continue
    fi
    if write_action; then
      record_resource oidc.mapping "$provider_name/$mname" updated "$(jq -nc --argjson d "$diff" '{dry_run: true, changed_fields: $d}')"
      continue
    fi
    api_call PUT "/access/api/v1/oidc/$provider_name/identity_mappings/$mname" "$desired_mapping"
    if [[ "$API_RC" -eq 0 ]]; then
      record_resource oidc.mapping "$provider_name/$mname" updated "$(jq -nc --arg s "$API_STATUS" --argjson d "$diff" '{http_status: ($s|tonumber), changed_fields: $d}')"
    else
      record_resource oidc.mapping "$provider_name/$mname" errored "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "update_failed"}')"
      record_error "Failed to update OIDC mapping $provider_name/$mname (HTTP $API_STATUS)"
    fi
  done
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

apply_project
# Members section depends on the project existing; if creation errored, bail
PROJECT_OK=$(jq -s '[.[] | select(.kind=="project")] | last | .outcome' "$RESOURCES_FILE")
case "$PROJECT_OK" in
  '"created"'|'"updated"'|'"already_exists"')
    apply_roles
    apply_members
    apply_oidc
    ;;
  *)
    record_warning "Project entity could not be created or updated; skipping roles, members, and OIDC."
    ;;
esac

FINISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ---------------------------------------------------------------------------
# Outcome report
# ---------------------------------------------------------------------------

REPORT=$(jq -n \
  --arg template_path "$TEMPLATE_PATH" \
  --arg template_version "$TPL_VERSION" \
  --arg blueprint "$(jq -r '.blueprint // "custom"' "$TEMPLATE_PATH")" \
  --arg server_id "${SERVER_ID:-default}" \
  --arg started_at "$STARTED_AT" \
  --arg finished_at "$FINISHED_AT" \
  --argjson dry_run "$( ((DRY_RUN == 1)) && echo true || echo false )" \
  --slurpfile resources "$RESOURCES_FILE" \
  --slurpfile warnings  "$WARNINGS_FILE" \
  --slurpfile errors    "$ERRORS_FILE" \
  '
    {
      template_path: $template_path,
      template_version: $template_version,
      blueprint: $blueprint,
      server_id: $server_id,
      dry_run: $dry_run,
      started_at: $started_at,
      finished_at: $finished_at,
      summary: ($resources | group_by(.outcome) | map({(.[0].outcome): length}) | add // {}),
      resources: $resources,
      warnings: ($warnings | map(.message)),
      errors:   ($errors   | map(.message))
    }
  ')

echo "$REPORT"

ERROR_COUNT=$(echo "$REPORT" | jq '.errors | length')
if [[ "$ERROR_COUNT" -gt 0 ]]; then
  exit 2
fi
exit 0
