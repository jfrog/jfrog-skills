#!/usr/bin/env bash
# jfrog-project-validate-repo-structure.sh — Validate Phase 3+4 sections of a
# JFrog Project template before applying them.
#
# Performs offline structural and semantic checks on stages, repositories,
# external_stage_rbac, and sharing entries. Falls back to ajv if installed
# for full JSON-Schema validation. With --check-platform, delegates to
# jfrog-project-apply-repo-structure.sh --dry-run for read-only platform
# lookups.
#
# Phase 1+2 sections are not re-validated here; run
# jfrog-project-validate-template.sh in addition (or before) for a complete
# validation pass.
#
# Usage:
#   jfrog-project-validate-repo-structure.sh <template.json>
#     [--server-id <id>] [--check-platform] [--strict-naming]
#
# Exit codes:
#   0 — Valid (warnings allowed)
#   1 — Usage / file / parse error
#   2 — One or more errors. Outcome JSON still written; inspect it.

set -euo pipefail

TEMPLATE_PATH=""
SERVER_ID=""
CHECK_PLATFORM=0
STRICT_NAMING=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-id) SERVER_ID="${2:-}"; shift 2 ;;
    --server-id=*) SERVER_ID="${1#--server-id=}"; shift ;;
    --check-platform) CHECK_PLATFORM=1; shift ;;
    --strict-naming) STRICT_NAMING=1; shift ;;
    -h|--help)
      sed -n '2,24p' "$0"
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
  echo "Usage: $0 <template.json> [--server-id <id>] [--check-platform] [--strict-naming]" >&2
  exit 1
fi
if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "ERROR: template file not found: $TEMPLATE_PATH" >&2
  exit 1
fi
for cmd in jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd is not installed on PATH" >&2
    exit 1
  fi
done
if ! jq -e . "$TEMPLATE_PATH" >/dev/null 2>&1; then
  echo "ERROR: template is not valid JSON: $TEMPLATE_PATH" >&2
  exit 1
fi

# Resolve schema path relative to the script
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCHEMA_PATH="$SCRIPT_DIR/../../jfrog/assets/project-templates/schema.json"
if [[ ! -f "$SCHEMA_PATH" ]]; then
  echo "ERROR: schema.json not found at $SCHEMA_PATH" >&2
  exit 1
fi

WORKDIR=$(mktemp -d -t jfrog-validate-3-4.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT
ERRORS_FILE="$WORKDIR/errors.ndjson"
WARNINGS_FILE="$WORKDIR/warnings.ndjson"
: >"$ERRORS_FILE" >"$WARNINGS_FILE"

record_error()   { jq -nc --arg c "$1" --arg m "$2" '{code:$c, message:$m}' >>"$ERRORS_FILE"; }
record_warning() { jq -nc --arg c "$1" --arg m "$2" '{code:$c, message:$m}' >>"$WARNINGS_FILE"; }

PROJECT_KEY=$(jq -r '.project.key // empty' "$TEMPLATE_PATH")
if [[ -z "$PROJECT_KEY" ]]; then
  record_error project_key_missing "project.key is required (Phase 1+2 base)"
fi

# ---------------------------------------------------------------------------
# Optional ajv full-schema validation
# ---------------------------------------------------------------------------

AJV_RAN=false
if command -v ajv &>/dev/null; then
  set +e
  AJV_OUT=$(ajv validate -s "$SCHEMA_PATH" -d "$TEMPLATE_PATH" --strict=false 2>&1)
  AJV_RC=$?
  set -e
  AJV_RAN=true
  if [[ "$AJV_RC" -ne 0 ]]; then
    record_error ajv_failed "ajv schema validation failed: $AJV_OUT"
  fi
else
  record_warning ajv_missing "ajv not installed — skipping JSON-Schema validation. Run \`npm install -g ajv-cli\` for full coverage."
fi

# ---------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------

STAGES_JSON=$(jq -c '.stages // []' "$TEMPLATE_PATH")
STAGE_COUNT=$(echo "$STAGES_JSON" | jq 'length')
if [[ "$STAGE_COUNT" -gt 0 ]]; then
  # Each stage must match ^[A-Za-z][A-Za-z0-9_-]*$
  while IFS= read -r stage; do
    [[ -z "$stage" ]] && continue
    if ! [[ "$stage" =~ ^[A-Za-z][A-Za-z0-9_-]*$ ]]; then
      record_error stage_format_invalid "stage '$stage' must match ^[A-Za-z][A-Za-z0-9_-]*$"
    fi
  done < <(echo "$STAGES_JSON" | jq -r '.[]')

  if ! echo "$STAGES_JSON" | jq -e 'map(. == "PROD") | any' >/dev/null; then
    record_warning prod_missing "stages[] does not include PROD; doctrine recommends every project has a PROD stage"
  fi
  if ! echo "$STAGES_JSON" | jq -e 'map(. == "External") | any' >/dev/null; then
    record_warning external_missing "stages[] does not include 'External'; doctrine strongly recommends an External stage as a supply-chain boundary"
  fi
fi

# ---------------------------------------------------------------------------
# Repositories
# ---------------------------------------------------------------------------

REPO_COUNT=$(jq '.repositories // [] | length' "$TEMPLATE_PATH")
if [[ "$REPO_COUNT" -gt 0 ]]; then
  # Build a flat name list (derived or override) and a maturity set per tech.
  ALL_NAMES_FILE="$WORKDIR/all_names.txt"
  : >"$ALL_NAMES_FILE"

  i=0
  while [[ "$i" -lt "$REPO_COUNT" ]]; do
    entry=$(jq -c ".repositories[$i]" "$TEMPLATE_PATH")
    tech=$(echo "$entry" | jq -r '.tech // empty')
    maturity=$(echo "$entry" | jq -r '.maturity // empty')
    locator=$(echo "$entry" | jq -r '.locator // empty')
    name_override=$(echo "$entry" | jq -r '.name_override // empty')
    url=$(echo "$entry" | jq -r '.url // empty')

    # Required fields
    for f in tech maturity locator; do
      val=$(echo "$entry" | jq -r --arg f "$f" '.[$f] // empty')
      if [[ -z "$val" ]]; then
        record_error repo_field_missing "repositories[$i]: required field '$f' missing"
      fi
    done

    # tech format
    if [[ -n "$tech" ]] && ! [[ "$tech" =~ ^[a-z][a-z0-9]*$ ]]; then
      record_error repo_tech_format "repositories[$i]: tech '$tech' must be lowercase alphanumeric"
    fi
    # maturity format
    if [[ -n "$maturity" ]] && ! [[ "$maturity" =~ ^[a-z][a-z0-9-]*$ ]]; then
      record_error repo_maturity_format "repositories[$i]: maturity '$maturity' must be lowercase"
    fi
    # locator enum
    case "$locator" in
      local|remote|virtual) ;;
      *) record_error repo_locator_invalid "repositories[$i]: locator '$locator' must be local|remote|virtual" ;;
    esac

    # locator-conditional fields
    if [[ "$locator" == "remote" ]]; then
      if [[ -z "$url" ]]; then
        record_error repo_remote_url_missing "repositories[$i]: locator=remote requires url"
      elif ! [[ "$url" =~ ^https?:// ]]; then
        record_error repo_remote_url_invalid "repositories[$i]: url '$url' must be http(s)"
      fi
    fi
    if [[ "$locator" == "virtual" ]]; then
      aggs=$(echo "$entry" | jq -r '.aggregates // [] | length')
      reso=$(echo "$entry" | jq -r '.resolution_order // [] | length')
      if [[ "$aggs" -eq 0 ]]; then
        record_error repo_virtual_aggregates_missing "repositories[$i]: locator=virtual requires aggregates[]"
      fi
      if [[ "$reso" -eq 0 ]]; then
        record_error repo_virtual_order_missing "repositories[$i]: locator=virtual requires resolution_order[]"
      fi
      # Each token in resolution_order must be in aggregates
      while IFS= read -r tok; do
        [[ -z "$tok" ]] && continue
        if ! echo "$entry" | jq -e --arg t "$tok" '.aggregates // [] | map(. == $t) | any' >/dev/null; then
          record_error repo_virtual_order_orphan "repositories[$i]: resolution_order token '$tok' not in aggregates[]"
        fi
      done < <(echo "$entry" | jq -r '.resolution_order // [] | .[]')
    fi

    # Maturity-in-stages check
    if [[ -n "$maturity" && "$STAGE_COUNT" -gt 0 && "$maturity" != "all" ]]; then
      # Compare case-insensitive against stages[]
      if ! echo "$STAGES_JSON" | jq -e --arg m "$maturity" 'map(ascii_downcase) | map(. == ($m | ascii_downcase)) | any' >/dev/null; then
        record_error repo_maturity_not_in_stages "repositories[$i]: maturity '$maturity' is not in stages[]"
      fi
    fi

    # Derive name and check naming convention
    if [[ -n "$name_override" ]]; then
      derived="$name_override"
    elif [[ -n "$tech" && -n "$maturity" && -n "$locator" && -n "$PROJECT_KEY" ]]; then
      derived="${PROJECT_KEY}-${tech}-${maturity}-${locator}"
    else
      derived=""
    fi
    if [[ -n "$derived" ]]; then
      if [[ -n "$PROJECT_KEY" ]] && ! [[ "$derived" =~ ^${PROJECT_KEY}-[a-z][a-z0-9]*-[a-z][a-z0-9-]*-(local|remote|virtual)$ ]]; then
        if (( STRICT_NAMING == 1 )); then
          record_error repo_naming_violation "repositories[$i]: name '$derived' violates 4-part convention (strict)"
        else
          record_warning repo_naming_violation "repositories[$i]: name '$derived' violates 4-part convention (warn-only; pass --strict-naming to fail)"
        fi
      fi
      # Duplicate check
      if grep -Fxq "$derived" "$ALL_NAMES_FILE"; then
        record_error repo_name_duplicate "repositories[$i]: derived name '$derived' duplicates an earlier entry"
      else
        echo "$derived" >>"$ALL_NAMES_FILE"
      fi
    fi

    i=$((i+1))
  done
fi

# ---------------------------------------------------------------------------
# External-stage RBAC
# ---------------------------------------------------------------------------

if jq -e 'has("external_stage_rbac")' "$TEMPLATE_PATH" >/dev/null; then
  ROLES=$(jq -r '.external_stage_rbac | keys[]' "$TEMPLATE_PATH")
  while IFS= read -r role; do
    [[ -z "$role" ]] && continue
    actions_count=$(jq --arg r "$role" '.external_stage_rbac[$r] | length' "$TEMPLATE_PATH")
    if [[ "$actions_count" -eq 0 ]]; then
      record_error rbac_actions_empty "external_stage_rbac['$role']: actions[] is empty"
    fi
    while IFS= read -r action; do
      [[ -z "$action" ]] && continue
      if ! [[ "$action" =~ ^[A-Z_]+$ ]]; then
        record_error rbac_action_format "external_stage_rbac['$role']: action '$action' must be UPPER_SNAKE_CASE"
      fi
    done < <(jq -r --arg r "$role" '.external_stage_rbac[$r][]' "$TEMPLATE_PATH")
  done <<<"$ROLES"
fi

# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------

SHARE_COUNT=$(jq '.sharing // [] | length' "$TEMPLATE_PATH")
if [[ "$SHARE_COUNT" -gt 0 ]]; then
  i=0
  while [[ "$i" -lt "$SHARE_COUNT" ]]; do
    entry=$(jq -c ".sharing[$i]" "$TEMPLATE_PATH")
    role=$(echo "$entry" | jq -r '.role // empty')
    case "$role" in
      producer)
        repo=$(echo "$entry" | jq -r '.repository // empty')
        consumers_count=$(echo "$entry" | jq '.consumer_projects // [] | length')
        if [[ -z "$repo" ]]; then
          record_error sharing_producer_repo_missing "sharing[$i]: producer entry requires repository"
        fi
        if [[ "$consumers_count" -eq 0 ]]; then
          record_error sharing_producer_consumers_missing "sharing[$i]: producer entry requires non-empty consumer_projects[]"
        fi
        # Refuse forbidden fields on producer entries
        for f in via from_project from_repository into_repository; do
          if echo "$entry" | jq -e --arg f "$f" 'has($f)' >/dev/null; then
            record_error sharing_producer_extraneous "sharing[$i]: producer entry must not include '$f'"
          fi
        done
        # Refuse sharing dev-local
        if [[ "$repo" == *"-dev-local" ]]; then
          record_error sharing_producer_dev_local "sharing[$i]: refuses to share '$repo' (dev artifacts are unstable; share prod-local instead)"
        fi
        ;;
      consumer)
        via=$(echo "$entry" | jq -r '.via // empty')
        from_proj=$(echo "$entry" | jq -r '.from_project // empty')
        from_repo=$(echo "$entry" | jq -r '.from_repository // empty')
        if [[ -z "$via" ]]; then
          record_error sharing_consumer_via_missing "sharing[$i]: consumer entry requires via (direct|smart-remote)"
        fi
        if [[ -z "$from_proj" ]]; then
          record_error sharing_consumer_from_project_missing "sharing[$i]: consumer entry requires from_project"
        fi
        if [[ -z "$from_repo" ]]; then
          record_error sharing_consumer_from_repository_missing "sharing[$i]: consumer entry requires from_repository"
        fi
        case "$via" in
          direct)
            if echo "$entry" | jq -e 'has("into_repository")' >/dev/null; then
              record_error sharing_consumer_direct_into_extraneous "sharing[$i]: consumer/direct must not include into_repository"
            fi
            ;;
          smart-remote)
            into_repo=$(echo "$entry" | jq -r '.into_repository // empty')
            if [[ -z "$into_repo" ]]; then
              record_error sharing_consumer_smart_remote_into_missing "sharing[$i]: consumer/smart-remote requires into_repository"
            fi
            ;;
          *)
            record_error sharing_consumer_via_invalid "sharing[$i]: via '$via' must be direct or smart-remote"
            ;;
        esac
        if echo "$entry" | jq -e 'has("consumer_projects")' >/dev/null; then
          record_error sharing_consumer_consumers_extraneous "sharing[$i]: consumer entry must not include consumer_projects[]"
        fi
        ;;
      *)
        record_error sharing_role_invalid "sharing[$i]: role '$role' must be producer or consumer"
        ;;
    esac
    i=$((i+1))
  done
fi

# ---------------------------------------------------------------------------
# Optional platform check
# ---------------------------------------------------------------------------

PLATFORM_REPORT="null"
if (( CHECK_PLATFORM == 1 )); then
  APPLY_SCRIPT="$SCRIPT_DIR/jfrog-project-apply-repo-structure.sh"
  if [[ ! -x "$APPLY_SCRIPT" ]]; then
    record_warning platform_check_skipped "apply script not executable; skipping platform check"
  else
    APPLY_ARGS=("$TEMPLATE_PATH" "--dry-run")
    if [[ -n "$SERVER_ID" ]]; then
      APPLY_ARGS+=("--server-id" "$SERVER_ID")
    fi
    if (( STRICT_NAMING == 1 )); then
      APPLY_ARGS+=("--strict-naming")
    fi
    set +e
    PLATFORM_OUT=$("$APPLY_SCRIPT" "${APPLY_ARGS[@]}" 2>&1)
    APPLY_RC=$?
    set -e
    if [[ "$APPLY_RC" -eq 0 || "$APPLY_RC" -eq 2 ]]; then
      if echo "$PLATFORM_OUT" | jq -e . >/dev/null 2>&1; then
        PLATFORM_REPORT="$PLATFORM_OUT"
      else
        record_warning platform_check_unparseable "apply --dry-run output not valid JSON; check apply script directly"
      fi
    else
      record_error platform_check_failed "apply --dry-run exited $APPLY_RC: $PLATFORM_OUT"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Outcome JSON
# ---------------------------------------------------------------------------

REPORT=$(jq -n \
  --arg template_path "$TEMPLATE_PATH" \
  --arg project_key "$PROJECT_KEY" \
  --argjson ajv_ran "$AJV_RAN" \
  --argjson check_platform "$( ((CHECK_PLATFORM == 1)) && echo true || echo false )" \
  --argjson strict_naming "$( ((STRICT_NAMING == 1)) && echo true || echo false )" \
  --slurpfile errors "$ERRORS_FILE" \
  --slurpfile warnings "$WARNINGS_FILE" \
  --argjson platform_dry_run "$PLATFORM_REPORT" \
  '
    {
      template_path: $template_path,
      project_key: $project_key,
      valid: (($errors | length) == 0),
      errors: $errors,
      warnings: $warnings,
      ajv_ran: $ajv_ran,
      check_platform: $check_platform,
      strict_naming: $strict_naming,
      platform_dry_run: $platform_dry_run
    }
  ')

echo "$REPORT"

ERR_COUNT=$(echo "$REPORT" | jq '.errors | length')
WARN_COUNT=$(echo "$REPORT" | jq '.warnings | length')
if [[ "$ERR_COUNT" -gt 0 ]]; then
  echo "Template has $ERR_COUNT error(s) and $WARN_COUNT warning(s)" >&2
  exit 2
fi
echo "Template OK ($WARN_COUNT warning(s))" >&2
exit 0
