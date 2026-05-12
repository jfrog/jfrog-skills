#!/usr/bin/env bash
# project-template-runtime.sh — Shared runtime for the project workflow
# skill scripts.
#
# This file is meant to be SOURCED, not executed. It provides the common
# prologue (argument parsing, prerequisite checks, workspace setup,
# template ingestion + basic validation) and helpers (HTTP wrappers,
# outcome accumulators, audit upload, outcome JSON v2 emission) shared
# across these four scripts:
#
#   - jfrog-project-setup/scripts/jfrog-project-create-from-template.sh
#   - jfrog-project-setup/scripts/jfrog-project-validate-template.sh
#   - jfrog-project-setup/scripts/jfrog-project-apply-repo-structure.sh
#   - jfrog-project-setup/scripts/jfrog-project-validate-repo-structure.sh
#
# The per-script endpoint-reference comment blocks at the top of each
# caller intentionally remain there: SME hallucination-mitigation guidance
# says every script that mutates the platform should list every endpoint
# it touches in one place, and a runtime library cannot carry these
# meaningfully (the validate scripts use no endpoints, and the two apply
# scripts touch disjoint surface areas).
#
# Sourcing pattern (place at the top of every caller):
#
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/../../jfrog/scripts/lib/project-template-runtime.sh"
#
# Globals set by parse_common_args:
#   SERVER_ID, TEMPLATE_URL, DRY_RUN, AUDIT, CHECK_PLATFORM, STRICT_NAMING
#   SERVER_FLAG[]   (passed to every `jf api` call)
#
# Globals set by setup_workspace:
#   WORKDIR, TEMPLATE_PATH, RESOURCES_FILE, WARNINGS_FILE, ERRORS_FILE
#   STARTED_AT
#
# Globals set by ingest_template:
#   INPUT_SOURCE  (stdin | template-url)
#
# Globals set by validate_template_basics:
#   TPL_VERSION, PROJECT_KEY
#
# Globals set by api_call:
#   API_RC, API_STATUS, API_OUT_FILE, API_ERR_FILE

# ---------------------------------------------------------------------------
# Argument parsing
#
# Accepts all flags used by any of the four scripts; each caller initialises
# only the flags it cares about. Unknown flags fail with a clear message.
# Callers that want extras can define print_help() (used by -h/--help) and
# can pre-parse their own flag(s) by stripping them from "$@" before
# calling parse_common_args.
# ---------------------------------------------------------------------------

parse_common_args() {
  SERVER_ID="${SERVER_ID:-}"
  TEMPLATE_URL="${TEMPLATE_URL:-}"
  DRY_RUN="${DRY_RUN:-0}"
  AUDIT="${AUDIT:-0}"
  CHECK_PLATFORM="${CHECK_PLATFORM:-0}"
  STRICT_NAMING="${STRICT_NAMING:-0}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --server-id) SERVER_ID="${2:-}"; shift 2 ;;
      --server-id=*) SERVER_ID="${1#--server-id=}"; shift ;;
      --template-url) TEMPLATE_URL="${2:-}"; shift 2 ;;
      --template-url=*) TEMPLATE_URL="${1#--template-url=}"; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --audit) AUDIT=1; shift ;;
      --check-platform) CHECK_PLATFORM=1; shift ;;
      --strict-naming) STRICT_NAMING=1; shift ;;
      -h|--help)
        if declare -f print_help >/dev/null 2>&1; then
          print_help
        else
          sed -n '2,40p' "$0"
        fi
        exit 0
        ;;
      *)
        echo "ERROR: unexpected argument: $1" >&2
        exit 1
        ;;
    esac
  done

  SERVER_FLAG=()
  if [[ -n "$SERVER_ID" ]]; then
    SERVER_FLAG=(--server-id="$SERVER_ID")
  fi
}

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

check_prereqs() {
  local cmd
  for cmd in "$@"; do
    if ! command -v "$cmd" &>/dev/null; then
      echo "ERROR: $cmd is not installed on PATH" >&2
      exit 1
    fi
  done
}

# ---------------------------------------------------------------------------
# Workspace
#
# Creates a single mktemp -d workspace and the three NDJSON accumulator
# files used by record_resource/warning/error and emit_outcome. Validate
# scripts that don't use the accumulator files can ignore them; they cost
# a few bytes on disk for the duration of the script.
# ---------------------------------------------------------------------------

setup_workspace() {
  local prefix="${1:-jfrog-project-template}"
  WORKDIR=$(mktemp -d -t "$prefix.XXXXXX")
  trap 'rm -rf "$WORKDIR"' EXIT
  TEMPLATE_PATH="$WORKDIR/template.json"
  RESOURCES_FILE="$WORKDIR/resources.ndjson"
  WARNINGS_FILE="$WORKDIR/warnings.ndjson"
  ERRORS_FILE="$WORKDIR/errors.ndjson"
  : >"$RESOURCES_FILE" >"$WARNINGS_FILE" >"$ERRORS_FILE"
  STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
}

# ---------------------------------------------------------------------------
# Template ingestion (stdin vs --template-url)
#
# On any failure, prints ERROR to stderr and exits 1. Callers that want a
# JSON-shaped failure on bad input must pre-validate before calling.
# ---------------------------------------------------------------------------

ingest_template() {
  INPUT_SOURCE="stdin"
  if [[ -n "$TEMPLATE_URL" ]]; then
    INPUT_SOURCE="template-url"
    if ! command -v jf >/dev/null 2>&1; then
      echo "ERROR: --template-url requires jf CLI" >&2
      exit 1
    fi
    if ! jf api "$TEMPLATE_URL" "${SERVER_FLAG[@]+"${SERVER_FLAG[@]}"}" >"$TEMPLATE_PATH" 2>"$WORKDIR/fetch.err"; then
      echo "ERROR: failed to fetch template from $TEMPLATE_URL" >&2
      cat "$WORKDIR/fetch.err" >&2 || true
      exit 1
    fi
  else
    if [[ -t 0 ]]; then
      echo "ERROR: no template on stdin and --template-url not set" >&2
      echo "Usage: echo \"\$JSON\" | $0 [<options>]" >&2
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
}

# Validate the two mandatory top-level fields used by every apply script.
# Sets TPL_VERSION and PROJECT_KEY on success; exits 1 with a stderr
# message on the first failure. Apply scripts should call this; validate
# scripts that want to record these as recoverable errors should not.
validate_template_basics() {
  TPL_VERSION=$(jq -r '.template_version // empty' "$TEMPLATE_PATH")
  if [[ -z "$TPL_VERSION" ]]; then
    echo "ERROR: template_version missing in input" >&2
    exit 1
  fi
  local major="${TPL_VERSION%%.*}"
  if [[ "$major" != "1" ]]; then
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
}

# ---------------------------------------------------------------------------
# HTTP helpers (`jf api` wrappers)
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
      --input "$body_file" "${SERVER_FLAG[@]+"${SERVER_FLAG[@]}"}" >"$out" 2>"$err"
  else
    jf api "$path" -X "$method" "${SERVER_FLAG[@]+"${SERVER_FLAG[@]}"}" >"$out" 2>"$err"
  fi
  API_RC=$?
  set -e
  API_STATUS=$(http_status_of "$err")
  API_OUT_FILE="$out"
  API_ERR_FILE="$err"
}

# ---------------------------------------------------------------------------
# Outcome accumulators (apply-script flavour)
#
# Validate scripts that need a different record shape (e.g. with a `code`
# field) should define their own record_error/record_warning before
# sourcing or override after sourcing.
# ---------------------------------------------------------------------------

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

# Returns 0 in --dry-run mode (caller should record_resource and return);
# returns 1 otherwise (caller should perform the actual write).
write_action() {
  if (( DRY_RUN == 1 )); then
    API_RC=0
    API_STATUS=200
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# Audit upload (opt-in `--audit` PUT to Artifactory)
#
# Skips silently when AUDIT==0. Records a warning (not an error) when the
# upload itself fails — apply success is unchanged by audit-upload failure.
#
# Args:
#   $1  Suffix appended to the project key in the audit path. Use "" for
#       creation (`<key>-<ts>.json`) and "-repos" for repo-structure
#       (`<key>-repos-<ts>.json`).
# ---------------------------------------------------------------------------

audit_upload() {
  local suffix="${1:-}"
  (( AUDIT == 1 )) || return 0

  local error_count
  error_count=$(wc -l <"$ERRORS_FILE" | tr -d ' ')
  if [[ "$error_count" -ne 0 ]]; then
    record_warning "Audit upload skipped: apply produced errors."
    return 0
  fi

  local repo ts path
  repo="${JFROG_PROJECT_TEMPLATES_REPO:-project-templates-generic-local}"
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  path="/artifactory/$repo/applied/$PROJECT_KEY${suffix}-$ts.json"

  if (( DRY_RUN == 1 )); then
    record_resource audit "$path" skipped '{"note": "dry_run"}'
    return 0
  fi

  if ! jf api "$path" -X PUT -H "Content-Type: application/json" \
        --input "$TEMPLATE_PATH" "${SERVER_FLAG[@]+"${SERVER_FLAG[@]}"}" \
        >"$WORKDIR/audit.out" 2>"$WORKDIR/audit.err"; then
    local status
    status=$(http_status_of "$WORKDIR/audit.err")
    record_resource audit "$path" errored \
      "$(jq -nc --arg s "$status" '{http_status: ($s|tonumber), error: "audit_upload_failed"}')"
    record_warning "Audit upload to $path failed (HTTP $status); apply itself succeeded."
    return 0
  fi
  record_resource audit "$path" created '{"http_status": 201}'
}

# ---------------------------------------------------------------------------
# Outcome JSON v2 emitter
#
# Builds the standard outcome shape from RESOURCES_FILE / WARNINGS_FILE /
# ERRORS_FILE plus the run-level context globals. Caller passes a JSON
# object of extra fields to merge in (e.g. blueprint, strict_naming).
#
# Args:
#   $1  JSON object of extra top-level fields (default: {}).
#
# Echoes the assembled outcome JSON on stdout. Sets FINISHED_AT.
# ---------------------------------------------------------------------------

emit_outcome() {
  local extras_json="${1:-{\}}"
  FINISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  jq -n \
    --arg schema_version "2.0" \
    --arg input_source "$INPUT_SOURCE" \
    --arg template_url "$TEMPLATE_URL" \
    --arg template_version "$TPL_VERSION" \
    --arg project_key "$PROJECT_KEY" \
    --arg server_id "${SERVER_ID:-default}" \
    --arg started_at "$STARTED_AT" \
    --arg finished_at "$FINISHED_AT" \
    --argjson dry_run "$( ((DRY_RUN == 1)) && echo true || echo false )" \
    --argjson audit "$( ((AUDIT == 1)) && echo true || echo false )" \
    --argjson extras "$extras_json" \
    --slurpfile resources "$RESOURCES_FILE" \
    --slurpfile warnings  "$WARNINGS_FILE" \
    --slurpfile errors    "$ERRORS_FILE" \
    '
      {
        schema_version: $schema_version,
        input_source: $input_source,
        template_url: (if $template_url == "" then null else $template_url end),
        template_version: $template_version,
        project_key: $project_key,
        server_id: $server_id,
        dry_run: $dry_run,
        audit: $audit,
        started_at: $started_at,
        finished_at: $finished_at,
        summary: ($resources | group_by(.status) | map({(.[0].status): length}) | add // {}),
        resources: $resources,
        warnings: ($warnings | map(.message)),
        errors:   ($errors   | map(.message))
      } + $extras
    '
}
