#!/usr/bin/env bash
# jfrog-project-apply-repo-structure.sh — Apply the repository-structure
# sections of a JFrog Project template idempotently.
#
# v2: input is a stream, not a file path.
#
# Reads a JFrog project template (see
# <base_skill>/assets/project-templates/schema.json) from STDIN by default
# or fetches it via --template-url, and reconciles its `stages`,
# `repositories`, `external_stage_rbac`, and `sharing` sections on the
# JFrog Platform using GET-before-PUT/POST. The project-entity sections
# (project, admins, members, oidc) are ignored here — they belong to
# jfrog-project-create-from-template.sh.
#
# All platform API calls go through `jf api` against the resolved server.
# Network permission is required (run via the Shell tool with
# required_permissions: ["full_network"]).
#
# Usage:
#   echo "$JSON" | jfrog-project-apply-repo-structure.sh [--server-id <id>] [--dry-run] [--strict-naming] [--audit]
#   jfrog-project-apply-repo-structure.sh --template-url <url> [--server-id <id>] [--dry-run] [--strict-naming] [--audit]
#
# Options:
#   --server-id <id>      Target a specific configured JFrog server
#   --template-url <url>  Fetch the template via `jf api <url>` instead of stdin
#   --dry-run             Run all GETs and decision logic but skip every write
#   --strict-naming       Fail on any 4-part-naming convention violation
#                         (default: warn and continue)
#   --audit               PUT a copy of the input to
#                         /artifactory/<templates-repo>/applied/<key>-<ts>.json
#                         after a successful apply
#
# Exit codes:
#   0 — every resource created/updated/already_exists/skipped-with-note
#   1 — usage / prerequisite / template / version error (no API calls made)
#   2 — one or more resources errored; outcome report still written

set -euo pipefail

# ---------------------------------------------------------------------------
# Endpoint reference (all paths used below; lifted here so the agent reading
# this script sees the full mutation surface in one place).
# ---------------------------------------------------------------------------
# Project (verify only):
#   GET    /access/api/v1/projects/<key>
# Environments / stages:
#   GET    /artifactory/api/repositories/configurations?type=virtual  (not used)
#   GET    /access/api/v1/projects/<key>/environments
#   POST   /access/api/v1/projects/<key>/environments
# Repositories:
#   GET    /artifactory/api/repositories/<repo>
#   PUT    /artifactory/api/repositories/<repo>
#   POST   /artifactory/api/repositories/<repo>
# External-stage RBAC:
#   PUT    /access/api/v1/projects/<key>/roles/<role>
# Cross-project sharing (Access API):
#   GET    /access/api/v1/projects/<key>/share/repositories
#   PUT    /access/api/v1/projects/<key>/share/repositories/<repo>/<target>
#   DELETE /access/api/v1/projects/<key>/share/repositories/<repo>/<target>
# Audit (optional):
#   PUT    /artifactory/<templates-repo>/applied/<key>-<ISO8601>.json

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

SERVER_ID=""
TEMPLATE_URL=""
DRY_RUN=0
STRICT_NAMING=0
AUDIT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-id) SERVER_ID="${2:-}"; shift 2 ;;
    --server-id=*) SERVER_ID="${1#--server-id=}"; shift ;;
    --template-url) TEMPLATE_URL="${2:-}"; shift 2 ;;
    --template-url=*) TEMPLATE_URL="${1#--template-url=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --strict-naming) STRICT_NAMING=1; shift ;;
    --audit) AUDIT=1; shift ;;
    -h|--help)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *)
      echo "ERROR: unexpected argument: $1" >&2
      exit 1
      ;;
  esac
done

for cmd in jq jf; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: ${cmd} is not installed on PATH" >&2
    exit 1
  fi
done

SERVER_FLAG=()
if [[ -n "$SERVER_ID" ]]; then
  SERVER_FLAG=(--server-id="$SERVER_ID")
fi

# ---------------------------------------------------------------------------
# Workspace + input ingestion
# ---------------------------------------------------------------------------

WORKDIR=$(mktemp -d -t jfrog-project-apply-repos.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT
TEMPLATE_PATH="$WORKDIR/template.json"
RESOURCES_FILE="$WORKDIR/resources.ndjson"
WARNINGS_FILE="$WORKDIR/warnings.ndjson"
ERRORS_FILE="$WORKDIR/errors.ndjson"
: >"$RESOURCES_FILE" >"$WARNINGS_FILE" >"$ERRORS_FILE"

INPUT_SOURCE="stdin"
if [[ -n "$TEMPLATE_URL" ]]; then
  INPUT_SOURCE="template-url"
  if ! jf api "$TEMPLATE_URL" "${SERVER_FLAG[@]}" >"$TEMPLATE_PATH" 2>"$WORKDIR/fetch.err"; then
    echo "ERROR: failed to fetch template from $TEMPLATE_URL" >&2
    cat "$WORKDIR/fetch.err" >&2 || true
    exit 1
  fi
else
  if [[ -t 0 ]]; then
    echo "ERROR: no template on stdin and --template-url not set" >&2
    echo "Usage: echo \"\$JSON\" | $0 [--server-id <id>] [--dry-run] [--strict-naming] [--audit]" >&2
    exit 1
  fi
  cat - >"$TEMPLATE_PATH"
fi

if [[ ! -s "$TEMPLATE_PATH" ]]; then
  echo "ERROR: template input is empty" >&2
  exit 1
fi

if ! jq -e . "$TEMPLATE_PATH" >/dev/null 2>&1; then
  echo "ERROR: template input is not valid JSON" >&2
  exit 1
fi

TPL_VERSION=$(jq -r '.template_version // empty' "$TEMPLATE_PATH")
if [[ -z "$TPL_VERSION" ]]; then
  echo "ERROR: template_version missing in input" >&2
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
  echo "ERROR: project.key '$PROJECT_KEY' violates the naming rule" >&2
  exit 1
fi

STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Naming-convention regex: <project_key>-<tech>-<maturity>-<locator>
NAMING_REGEX="^${PROJECT_KEY}-[a-z][a-z0-9]*-[a-z][a-z0-9-]*-(local|remote|virtual)$"

# ---------------------------------------------------------------------------
# Helpers (mirrored from jfrog-project-create-from-template.sh)
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
  local kind="$1"
  local id="$2"
  local outcome="$3"
  local extra="${4:-{\}}"
  jq -nc \
    --arg kind "$kind" \
    --arg id "$id" \
    --arg outcome "$outcome" \
    --argjson extra "$extra" \
    '{kind:$kind, key:$id, status:$outcome} + $extra' \
    >>"$RESOURCES_FILE"
}

record_warning() {
  jq -nc --arg msg "$1" '{message:$msg}' >>"$WARNINGS_FILE"
}

record_error() {
  jq -nc --arg msg "$1" '{message:$msg}' >>"$ERRORS_FILE"
}

write_action() {
  if (( DRY_RUN == 1 )); then
    API_RC=0
    API_STATUS=200
    return 0
  fi
  return 1
}

# Derive the full repo name from a template entry.
# Args: tech, maturity, locator, name_override
derive_repo_name() {
  local tech="$1"
  local maturity="$2"
  local locator="$3"
  local override="${4:-}"
  if [[ -n "$override" && "$override" != "null" ]]; then
    echo "$override"
    return
  fi
  echo "${PROJECT_KEY}-${tech}-${maturity}-${locator}"
}

# Resolve a maturity token (e.g. "prod") to a full repo name within a tech.
# Args: tech, maturity_token
# Reads the template for that tech's repos and returns the matching name.
resolve_maturity_to_name() {
  local tech="$1"
  local mat="$2"
  jq -r --arg tech "$tech" --arg mat "$mat" --arg pk "$PROJECT_KEY" '
    .repositories // []
    | map(select(.tech == $tech and .maturity == $mat))
    | .[0]
    | if . == null then empty
      elif (.name_override // null) != null then .name_override
      else "\($pk)-\(.tech)-\(.maturity)-\(.locator)" end
  ' "$TEMPLATE_PATH"
}

# ---------------------------------------------------------------------------
# Section 1: Verify project exists (platform 403s surface verbatim if not authorised)
# ---------------------------------------------------------------------------

verify_project() {
  api_call GET "/access/api/v1/projects/$PROJECT_KEY"
  if [[ "$API_STATUS" != "200" ]]; then
    record_resource project "$PROJECT_KEY" errored \
      "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "project_not_found"}')"
    record_error "Project $PROJECT_KEY not found (HTTP $API_STATUS). Run jfrog-project-creation first."
    return 1
  fi
  record_resource project "$PROJECT_KEY" already_exists '{"http_status": 200, "note": "verified"}'
  return 0
}

# ---------------------------------------------------------------------------
# Section 2: Stages → project environments
# ---------------------------------------------------------------------------

apply_stages() {
  local count
  count=$(jq '.stages // [] | length' "$TEMPLATE_PATH")
  if [[ "$count" -eq 0 ]]; then return 0; fi

  api_call GET "/access/api/v1/projects/$PROJECT_KEY/environments"
  local existing_envs="[]"
  if [[ "$API_STATUS" == "200" ]]; then
    existing_envs=$(jq -c '[.[] | .name] // []' "$API_OUT_FILE" 2>/dev/null || echo "[]")
  fi

  local i
  for ((i=0; i<count; i++)); do
    local stage
    stage=$(jq -r ".stages[$i]" "$TEMPLATE_PATH")

    local already
    already=$(echo "$existing_envs" | jq --arg s "$stage" 'map(. == $s) | any')

    if [[ "$already" == "true" ]]; then
      record_resource environment "$stage" already_exists '{"http_status": 200}'
      continue
    fi

    if write_action; then
      record_resource environment "$stage" created '{"dry_run": true}'
      continue
    fi

    api_call POST "/access/api/v1/projects/$PROJECT_KEY/environments" \
      "$(jq -nc --arg n "$stage" '{name:$n}')"
    if [[ "$API_RC" -eq 0 ]]; then
      record_resource environment "$stage" created \
        "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber)}')"
    else
      record_resource environment "$stage" errored \
        "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "create_failed"}')"
      record_error "Failed to create environment $stage (HTTP $API_STATUS)"
    fi
  done
}

# ---------------------------------------------------------------------------
# Section 3: Repositories (local, remote, virtual)
# ---------------------------------------------------------------------------

apply_repositories() {
  local count
  count=$(jq '.repositories // [] | length' "$TEMPLATE_PATH")
  if [[ "$count" -eq 0 ]]; then return 0; fi

  # Two passes: locals/remotes first, then virtuals (so virtuals reference
  # already-applied repos).
  apply_repos_pass "local"
  apply_repos_pass "remote"
  apply_repos_pass "virtual"
}

apply_repos_pass() {
  local pass_locator="$1"
  local count
  count=$(jq '.repositories // [] | length' "$TEMPLATE_PATH")

  local i
  for ((i=0; i<count; i++)); do
    local entry tech maturity locator name_override url name
    entry=$(jq -c ".repositories[$i]" "$TEMPLATE_PATH")
    tech=$(echo "$entry" | jq -r '.tech')
    maturity=$(echo "$entry" | jq -r '.maturity')
    locator=$(echo "$entry" | jq -r '.locator')
    [[ "$locator" != "$pass_locator" ]] && continue

    name_override=$(echo "$entry" | jq -r '.name_override // empty')
    url=$(echo "$entry" | jq -r '.url // empty')
    name=$(derive_repo_name "$tech" "$maturity" "$locator" "$name_override")

    # Naming-convention check
    if [[ ! "$name" =~ $NAMING_REGEX ]]; then
      if (( STRICT_NAMING == 1 )); then
        record_resource "repo.$locator" "$name" errored \
          "$(jq -nc --arg n "$name" '{error: "convention_violation", name: $n}')"
        record_error "Repository name '$name' violates 4-part naming convention (strict mode)"
        continue
      else
        record_warning "Repository name '$name' does not match the 4-part naming convention; accepted via --strict-naming-off default"
      fi
    fi

    apply_one_repo "$name" "$tech" "$locator" "$url" "$entry"
  done
}

apply_one_repo() {
  local name="$1"
  local tech="$2"
  local locator="$3"
  local url="$4"
  local entry_json="$5"

  api_call GET "/artifactory/api/repositories/$name"
  local current_status="$API_STATUS"
  local current_body="{}"
  if [[ "$current_status" == "200" ]]; then
    current_body=$(cat "$API_OUT_FILE")
  fi

  local desired_payload
  desired_payload=$(build_repo_payload "$name" "$tech" "$locator" "$url" "$entry_json")

  if [[ "$current_status" == "404" ]]; then
    if write_action; then
      record_resource "repo.$locator" "$name" created '{"dry_run": true}'
      return
    fi
    api_call PUT "/artifactory/api/repositories/$name" "$desired_payload"
    if [[ "$API_RC" -eq 0 ]]; then
      record_resource "repo.$locator" "$name" created \
        "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber)}')"
    else
      record_resource "repo.$locator" "$name" errored \
        "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "create_failed"}')"
      record_error "Failed to create repo $name (HTTP $API_STATUS)"
    fi
    return
  fi

  if [[ "$current_status" != "200" ]]; then
    record_resource "repo.$locator" "$name" errored \
      "$(jq -nc --arg s "$current_status" '{http_status: ($s|tonumber), error: "lookup_failed"}')"
    record_error "Failed to look up repo $name (HTTP $current_status)"
    return
  fi

  # 200 — compare relevant fields. We're permissive about extra fields
  # the server adds (like `defaultDeploymentRepo` on virtuals).
  local current_pkg current_proj current_url current_repos
  current_pkg=$(echo "$current_body" | jq -r '.packageType // empty')
  current_proj=$(echo "$current_body" | jq -r '.projectKey // empty')
  current_url=$(echo "$current_body" | jq -r '.url // empty')
  current_repos=$(echo "$current_body" | jq -c '.repositories // []')

  local desired_pkg desired_url desired_repos
  desired_pkg=$(echo "$desired_payload" | jq -r '.packageType // empty')
  desired_url=$(echo "$desired_payload" | jq -r '.url // empty')
  desired_repos=$(echo "$desired_payload" | jq -c '.repositories // []')

  # Project-assignment guard
  if [[ -n "$current_proj" && "$current_proj" != "$PROJECT_KEY" ]]; then
    record_resource "repo.$locator" "$name" skipped \
      "$(jq -nc --arg cp "$current_proj" --arg pk "$PROJECT_KEY" \
          '{error: "project_assignment_conflict", current_project: $cp, target_project: $pk}')"
    record_error "Repo $name is assigned to project '$current_proj' (template wants '$PROJECT_KEY'); skipped"
    return
  fi

  # Tech-drift guard
  if [[ -n "$current_pkg" && -n "$desired_pkg" && "$current_pkg" != "$desired_pkg" ]]; then
    record_resource "repo.$locator" "$name" skipped \
      "$(jq -nc --arg c "$current_pkg" --arg d "$desired_pkg" \
          '{error: "tech_drift", current_packageType: $c, desired_packageType: $d}')"
    record_error "Repo $name has packageType '$current_pkg' but template expects '$desired_pkg'; skipped"
    return
  fi

  # Compute diff
  local diff_fields=()
  if [[ "$locator" == "remote" && -n "$desired_url" && "$current_url" != "$desired_url" ]]; then
    diff_fields+=("url")
  fi
  if [[ "$locator" == "virtual" ]]; then
    if [[ "$(echo "$desired_repos" | jq -S .)" != "$(echo "$current_repos" | jq -S .)" ]]; then
      diff_fields+=("repositories")
    fi
  fi
  if [[ -z "$current_proj" ]]; then
    diff_fields+=("projectKey")
  fi

  if [[ ${#diff_fields[@]} -eq 0 ]]; then
    record_resource "repo.$locator" "$name" already_exists '{"http_status": 200}'
    return
  fi

  if write_action; then
    record_resource "repo.$locator" "$name" updated \
      "$(jq -nc --argjson d "$(printf '%s\n' "${diff_fields[@]}" | jq -R . | jq -sc .)" \
          '{dry_run: true, changed_fields: $d}')"
    return
  fi

  api_call PUT "/artifactory/api/repositories/$name" "$desired_payload"
  if [[ "$API_RC" -eq 0 ]]; then
    # Repo update succeeded; if projectKey was missing, also POST the assignment
    # explicitly (older Artifactory versions don't accept projectKey on PUT).
    if [[ -z "$current_proj" ]]; then
      api_call POST "/artifactory/api/repositories/$name" \
        "$(jq -nc --arg pk "$PROJECT_KEY" '{projectKey:$pk}')"
    fi
    record_resource "repo.$locator" "$name" updated \
      "$(jq -nc --arg s "$API_STATUS" \
          --argjson d "$(printf '%s\n' "${diff_fields[@]}" | jq -R . | jq -sc .)" \
          '{http_status: ($s|tonumber), changed_fields: $d}')"
  else
    record_resource "repo.$locator" "$name" errored \
      "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "update_failed"}')"
    record_error "Failed to update repo $name (HTTP $API_STATUS)"
  fi
}

# Build a repository config payload for PUT /artifactory/api/repositories/<key>
# Args: name, tech, locator, url, entry_json
build_repo_payload() {
  local name="$1"
  local tech="$2"
  local locator="$3"
  local url="$4"
  local entry_json="$5"

  case "$locator" in
    local)
      jq -nc \
        --arg key "$name" --arg pkg "$tech" --arg pk "$PROJECT_KEY" \
        '{key:$key, rclass:"local", packageType:$pkg, projectKey:$pk}'
      ;;
    remote)
      jq -nc \
        --arg key "$name" --arg pkg "$tech" --arg url "$url" --arg pk "$PROJECT_KEY" \
        '{key:$key, rclass:"remote", packageType:$pkg, url:$url, projectKey:$pk}'
      ;;
    virtual)
      # Expand resolution_order (array of maturity tokens) to full repo names
      local tech_for_virt
      tech_for_virt=$(echo "$entry_json" | jq -r '.tech')
      local resolved="[]"
      local order
      order=$(echo "$entry_json" | jq -r '.resolution_order[]?')
      while IFS= read -r tok; do
        [[ -z "$tok" ]] && continue
        local rname
        rname=$(resolve_maturity_to_name "$tech_for_virt" "$tok")
        if [[ -z "$rname" ]]; then
          # Token is not a maturity — assume a literal repo name (shared / smart-remote
          # entries appended by the sharing flow may show up here).
          rname="$tok"
        fi
        resolved=$(echo "$resolved" | jq --arg r "$rname" '. + [$r]')
      done <<<"$order"
      jq -nc \
        --arg key "$name" --arg pkg "$tech" --arg pk "$PROJECT_KEY" \
        --argjson repos "$resolved" \
        '{key:$key, rclass:"virtual", packageType:$pkg, projectKey:$pk, repositories:$repos}'
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Section 4: External-stage RBAC overlay
# ---------------------------------------------------------------------------

apply_external_rbac() {
  local has_rbac
  has_rbac=$(jq 'has("external_stage_rbac")' "$TEMPLATE_PATH")
  if [[ "$has_rbac" != "true" ]]; then return 0; fi

  # Iterate role names
  local roles
  roles=$(jq -r '.external_stage_rbac | keys[]' "$TEMPLATE_PATH")
  while IFS= read -r role; do
    [[ -z "$role" ]] && continue
    local actions_json
    actions_json=$(jq -c --arg r "$role" '.external_stage_rbac[$r]' "$TEMPLATE_PATH")

    # GET current role config
    api_call GET "/access/api/v1/projects/$PROJECT_KEY/roles/$role"
    if [[ "$API_STATUS" == "404" ]]; then
      record_resource external_rbac "$role" skipped \
        '{"error": "role_not_found", "note": "ensure the role exists via Phase 1+2 first"}'
      record_warning "External-stage RBAC: role '$role' does not exist on project $PROJECT_KEY; skipped"
      continue
    fi
    if [[ "$API_STATUS" != "200" ]]; then
      record_resource external_rbac "$role" errored \
        "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "lookup_failed"}')"
      record_error "External-stage RBAC: failed to look up role $role (HTTP $API_STATUS)"
      continue
    fi

    local current_actions
    current_actions=$(jq -c '.actions // []' "$API_OUT_FILE")

    # Compute additive union: current actions ∪ desired External actions.
    # We do not strip any pre-existing actions; this overlay is additive only.
    local merged
    merged=$(jq -nc \
      --argjson c "$current_actions" \
      --argjson d "$actions_json" \
      '($c + $d) | unique')

    if [[ "$(echo "$current_actions" | jq -S .)" == "$(echo "$merged" | jq -S .)" ]]; then
      record_resource external_rbac "$role" already_exists '{"http_status": 200}'
      continue
    fi

    if write_action; then
      record_resource external_rbac "$role" updated \
        "$(jq -nc --argjson m "$merged" '{dry_run: true, merged_actions: $m}')"
      continue
    fi

    local update_body
    update_body=$(jq -nc \
      --slurpfile cur "$API_OUT_FILE" \
      --argjson m "$merged" \
      '$cur[0] | .actions = $m')
    api_call PUT "/access/api/v1/projects/$PROJECT_KEY/roles/$role" "$update_body"
    if [[ "$API_RC" -eq 0 ]]; then
      record_resource external_rbac "$role" updated \
        "$(jq -nc --arg s "$API_STATUS" --argjson m "$merged" '{http_status: ($s|tonumber), merged_actions: $m}')"
    else
      record_resource external_rbac "$role" errored \
        "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "update_failed"}')"
      record_error "External-stage RBAC: failed to update role $role (HTTP $API_STATUS)"
    fi
  done <<<"$roles"
}

# ---------------------------------------------------------------------------
# Section 5: Sharing
# ---------------------------------------------------------------------------

apply_sharing() {
  local count
  count=$(jq '.sharing // [] | length' "$TEMPLATE_PATH")
  if [[ "$count" -eq 0 ]]; then return 0; fi

  local i
  for ((i=0; i<count; i++)); do
    local entry role
    entry=$(jq -c ".sharing[$i]" "$TEMPLATE_PATH")
    role=$(echo "$entry" | jq -r '.role')
    case "$role" in
      producer) apply_sharing_producer "$entry" ;;
      consumer)
        local via
        via=$(echo "$entry" | jq -r '.via // empty')
        case "$via" in
          direct)        apply_sharing_consumer_direct "$entry" ;;
          smart-remote)  apply_sharing_consumer_smart_remote "$entry" ;;
          *)
            record_resource sharing "entry-$i" errored \
              '{"error": "consumer_via_missing"}'
            record_error "Sharing entry $i: consumer entry missing 'via' (direct|smart-remote)"
            ;;
        esac
        ;;
      *)
        record_resource sharing "entry-$i" errored \
          "$(jq -nc --arg r "$role" '{error: "unknown_role", role: $r}')"
        record_error "Sharing entry $i: unknown role '$role'"
        ;;
    esac
  done
}

apply_sharing_producer() {
  local entry="$1"
  local repo
  repo=$(echo "$entry" | jq -r '.repository')

  # Verify the producer owns the repo
  api_call GET "/artifactory/api/repositories/$repo"
  if [[ "$API_STATUS" != "200" ]]; then
    record_resource "sharing.producer" "$repo" errored \
      "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "repo_not_found"}')"
    record_error "Sharing producer: repo $repo not found (HTTP $API_STATUS)"
    return
  fi
  local current_proj
  current_proj=$(jq -r '.projectKey // empty' "$API_OUT_FILE")
  if [[ "$current_proj" != "$PROJECT_KEY" ]]; then
    record_resource "sharing.producer" "$repo" errored \
      "$(jq -nc --arg cp "$current_proj" --arg pk "$PROJECT_KEY" \
          '{error: "not_producer", current_project: $cp, expected: $pk}')"
    record_error "Sharing producer: repo $repo is owned by '$current_proj', not by template's project '$PROJECT_KEY'"
    return
  fi

  # Iterate consumer projects
  local consumers
  consumers=$(echo "$entry" | jq -r '.consumer_projects[]?')
  while IFS= read -r consumer; do
    [[ -z "$consumer" ]] && continue
    # Verify consumer project exists
    api_call GET "/access/api/v1/projects/$consumer"
    if [[ "$API_STATUS" != "200" ]]; then
      record_resource "sharing.producer" "$repo→$consumer" skipped \
        "$(jq -nc --arg c "$consumer" '{error: "principal_missing", consumer: $c}')"
      record_warning "Sharing producer: consumer project '$consumer' does not exist; skipped"
      continue
    fi

    # GET the existing share state (defensive: shape varies by platform version)
    api_call GET "/access/api/v1/projects/$PROJECT_KEY/share/repos"
    local already="false"
    if [[ "$API_STATUS" == "200" ]]; then
      already=$(jq --arg r "$repo" --arg c "$consumer" '
        . // []
        | map(select((.repository // .repo // "") == $r))
        | map(.target_projects // .targets // [])
        | flatten
        | map(. == $c)
        | any
      ' "$API_OUT_FILE" 2>/dev/null || echo "false")
    fi

    if [[ "$already" == "true" ]]; then
      record_resource "sharing.producer" "$repo→$consumer" already_exists '{"http_status": 200}'
      continue
    fi

    if write_action; then
      record_resource "sharing.producer" "$repo→$consumer" created '{"dry_run": true}'
      continue
    fi

    local share_body
    share_body=$(jq -nc --arg r "$repo" --arg c "$consumer" \
      '{repository: $r, target_projects: [$c]}')
    api_call POST "/access/api/v1/projects/$PROJECT_KEY/share/repos" "$share_body"
    if [[ "$API_RC" -eq 0 ]]; then
      record_resource "sharing.producer" "$repo→$consumer" created \
        "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber)}')"
    else
      record_resource "sharing.producer" "$repo→$consumer" errored \
        "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "share_failed"}')"
      record_error "Sharing producer: failed to share $repo with $consumer (HTTP $API_STATUS)"
    fi
  done <<<"$consumers"
}

apply_sharing_consumer_direct() {
  local entry="$1"
  local from_proj from_repo
  from_proj=$(echo "$entry" | jq -r '.from_project')
  from_repo=$(echo "$entry" | jq -r '.from_repository')

  # Confirm producer has shared with us
  api_call GET "/access/api/v1/projects/$from_proj/share/repos"
  local shared="false"
  if [[ "$API_STATUS" == "200" ]]; then
    shared=$(jq --arg r "$from_repo" --arg c "$PROJECT_KEY" '
      . // []
      | map(select((.repository // .repo // "") == $r))
      | map(.target_projects // .targets // [])
      | flatten
      | map(. == $c)
      | any
    ' "$API_OUT_FILE" 2>/dev/null || echo "false")
  fi

  if [[ "$shared" != "true" ]]; then
    record_resource "sharing.consumer.direct" "$from_proj/$from_repo" skipped \
      "$(jq -nc --arg p "$from_proj" --arg r "$from_repo" \
          '{error: "not_shared_with_consumer", from_project: $p, from_repository: $r}')"
    record_warning "Sharing consumer (direct): producer $from_proj has not shared $from_repo with $PROJECT_KEY; skipped"
    return
  fi

  record_resource "sharing.consumer.direct" "$from_proj/$from_repo" already_exists \
    '{"note": "verified shared; consumer-side virtual update is the responsibility of the repositories pass"}'
}

apply_sharing_consumer_smart_remote() {
  local entry="$1"
  local from_proj from_repo into_repo
  from_proj=$(echo "$entry" | jq -r '.from_project')
  from_repo=$(echo "$entry" | jq -r '.from_repository')
  into_repo=$(echo "$entry" | jq -r '.into_repository')

  # Resolve active server URL via jf config show
  local server_url=""
  set +e
  server_url=$(jf config show "${SERVER_FLAG[@]/--server-id=/}" 2>/dev/null \
    | awk -F': ' '/^Url:/ {print $2; exit}')
  set -e
  if [[ -z "$server_url" ]]; then
    record_resource "sharing.consumer.smart-remote" "$into_repo" errored \
      '{"error": "server_url_unresolved"}'
    record_error "Sharing consumer (smart-remote): could not resolve active server URL for $into_repo"
    return
  fi
  # Trim trailing slash and append /artifactory/<from_repo>/
  server_url="${server_url%/}"
  local upstream_url="${server_url}/artifactory/${from_repo}/"

  # Determine packageType from the producer repo (defensive; falls back if unknown)
  api_call GET "/artifactory/api/repositories/$from_repo"
  local pkg_type=""
  if [[ "$API_STATUS" == "200" ]]; then
    pkg_type=$(jq -r '.packageType // empty' "$API_OUT_FILE")
  fi
  if [[ -z "$pkg_type" ]]; then
    record_resource "sharing.consumer.smart-remote" "$into_repo" errored \
      "$(jq -nc --arg fr "$from_repo" '{error: "from_repo_missing_packageType", from_repository: $fr}')"
    record_error "Sharing consumer (smart-remote): cannot determine packageType for $from_repo"
    return
  fi

  api_call GET "/artifactory/api/repositories/$into_repo"
  local current_status="$API_STATUS"
  local desired_payload
  desired_payload=$(jq -nc \
    --arg key "$into_repo" --arg pkg "$pkg_type" --arg url "$upstream_url" --arg pk "$PROJECT_KEY" \
    '{key:$key, rclass:"remote", packageType:$pkg, url:$url, projectKey:$pk}')

  if [[ "$current_status" == "404" ]]; then
    if write_action; then
      record_resource "sharing.consumer.smart-remote" "$into_repo" created '{"dry_run": true}'
      return
    fi
    api_call PUT "/artifactory/api/repositories/$into_repo" "$desired_payload"
    if [[ "$API_RC" -eq 0 ]]; then
      record_resource "sharing.consumer.smart-remote" "$into_repo" created \
        "$(jq -nc --arg s "$API_STATUS" --arg url "$upstream_url" '{http_status: ($s|tonumber), url: $url}')"
    else
      record_resource "sharing.consumer.smart-remote" "$into_repo" errored \
        "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "create_failed"}')"
      record_error "Sharing consumer (smart-remote): failed to create $into_repo (HTTP $API_STATUS)"
    fi
    return
  fi

  if [[ "$current_status" != "200" ]]; then
    record_resource "sharing.consumer.smart-remote" "$into_repo" errored \
      "$(jq -nc --arg s "$current_status" '{http_status: ($s|tonumber), error: "lookup_failed"}')"
    record_error "Sharing consumer (smart-remote): failed to look up $into_repo (HTTP $current_status)"
    return
  fi

  # 200 — verify URL matches
  local current_url
  current_url=$(jq -r '.url // empty' "$API_OUT_FILE")
  if [[ "$current_url" == "$upstream_url" ]]; then
    record_resource "sharing.consumer.smart-remote" "$into_repo" already_exists \
      "$(jq -nc --arg url "$upstream_url" '{http_status: 200, url: $url}')"
    return
  fi

  if write_action; then
    record_resource "sharing.consumer.smart-remote" "$into_repo" updated \
      "$(jq -nc --arg cur "$current_url" --arg desired "$upstream_url" \
          '{dry_run: true, current_url: $cur, desired_url: $desired}')"
    return
  fi
  api_call PUT "/artifactory/api/repositories/$into_repo" "$desired_payload"
  if [[ "$API_RC" -eq 0 ]]; then
    record_resource "sharing.consumer.smart-remote" "$into_repo" updated \
      "$(jq -nc --arg s "$API_STATUS" --arg url "$upstream_url" '{http_status: ($s|tonumber), url: $url}')"
  else
    record_resource "sharing.consumer.smart-remote" "$into_repo" errored \
      "$(jq -nc --arg s "$API_STATUS" '{http_status: ($s|tonumber), error: "update_failed"}')"
    record_error "Sharing consumer (smart-remote): failed to update $into_repo (HTTP $API_STATUS)"
  fi
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Audit (opt-in PUT to Artifactory)
# ---------------------------------------------------------------------------

apply_audit() {
  (( AUDIT == 1 )) || return 0
  local error_count
  error_count=$(wc -l <"$ERRORS_FILE" | tr -d ' ')
  if [[ "$error_count" -ne 0 ]]; then
    record_warning "Audit upload skipped: apply produced errors."
    return 0
  fi

  local repo
  repo="${JFROG_PROJECT_TEMPLATES_REPO:-project-templates-generic-local}"
  local ts
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  local path="/artifactory/$repo/applied/$PROJECT_KEY-repos-$ts.json"

  if (( DRY_RUN == 1 )); then
    record_resource audit "$path" skipped '{"note": "dry_run"}'
    return 0
  fi

  if ! jf api "$path" -X PUT -H "Content-Type: application/json" \
        --input "$TEMPLATE_PATH" "${SERVER_FLAG[@]}" \
        >"$WORKDIR/audit.out" 2>"$WORKDIR/audit.err"; then
    local status
    status=$(http_status_of "$WORKDIR/audit.err")
    record_resource audit "$path" errored "$(jq -nc --arg s "$status" '{http_status: ($s|tonumber), error: "audit_upload_failed"}')"
    record_warning "Audit upload to $path failed (HTTP $status); apply itself succeeded."
    return 0
  fi
  record_resource audit "$path" created '{"http_status": 201}'
}

if verify_project; then
  apply_stages
  apply_repositories
  apply_external_rbac
  apply_sharing
  apply_audit
fi

FINISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ---------------------------------------------------------------------------
# Outcome report
# ---------------------------------------------------------------------------

REPORT=$(jq -n \
  --arg schema_version "2.0" \
  --arg input_source "$INPUT_SOURCE" \
  --arg template_url "$TEMPLATE_URL" \
  --arg template_version "$TPL_VERSION" \
  --arg blueprint "$(jq -r '.blueprint // "custom"' "$TEMPLATE_PATH")" \
  --arg project_key "$PROJECT_KEY" \
  --arg server_id "${SERVER_ID:-default}" \
  --arg started_at "$STARTED_AT" \
  --arg finished_at "$FINISHED_AT" \
  --argjson dry_run "$( ((DRY_RUN == 1)) && echo true || echo false )" \
  --argjson strict_naming "$( ((STRICT_NAMING == 1)) && echo true || echo false )" \
  --argjson audit "$( ((AUDIT == 1)) && echo true || echo false )" \
  --slurpfile resources "$RESOURCES_FILE" \
  --slurpfile warnings  "$WARNINGS_FILE" \
  --slurpfile errors    "$ERRORS_FILE" \
  '
    {
      schema_version: $schema_version,
      input_source: $input_source,
      template_url: (if $template_url == "" then null else $template_url end),
      template_version: $template_version,
      blueprint: $blueprint,
      project_key: $project_key,
      server_id: $server_id,
      dry_run: $dry_run,
      strict_naming: $strict_naming,
      audit: $audit,
      started_at: $started_at,
      finished_at: $finished_at,
      summary: ($resources | group_by(.status) | map({(.[0].status): length}) | add // {}),
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
