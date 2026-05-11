#!/usr/bin/env bash
# jfrog-project-validate-template.sh — Validate a JFrog Project template.
#
# v2: input is a stream, not a file path.
#
# Performs offline structural checks against
# <base_skill>/assets/project-templates/schema.json (or its key constraints
# when ajv is unavailable) and a quick semantic pass (project_key regex,
# member oneOf, OIDC scope syntax). When --check-platform is set,
# additionally calls the apply script in --dry-run mode to surface what
# would happen on the resolved JFrog server (read-only).
#
# Usage:
#   echo "$JSON" | jfrog-project-validate-template.sh [--check-platform] [--server-id <id>]
#   jfrog-project-validate-template.sh --template-url <url> [--check-platform] [--server-id <id>]
#
# Options:
#   --template-url <url>  Fetch the template via `jf api <url>` instead of stdin
#   --check-platform      Additionally run the apply script with --dry-run
#                         to do read-only lookups (principal existence,
#                         OIDC provider)
#   --server-id <id>      Pass through to --check-platform
#
# Output:
#   Human-readable findings on stderr; structured JSON summary on stdout.
#
# Exit codes:
#   0 — Template is valid.
#   1 — Usage / prerequisite error (no validation performed).
#   2 — Template has structural or semantic errors.

set -euo pipefail

CHECK_PLATFORM=0
SERVER_ID=""
TEMPLATE_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-platform) CHECK_PLATFORM=1; shift ;;
    --server-id) SERVER_ID="${2:-}"; shift 2 ;;
    --server-id=*) SERVER_ID="${1#--server-id=}"; shift ;;
    --template-url) TEMPLATE_URL="${2:-}"; shift 2 ;;
    --template-url=*) TEMPLATE_URL="${1#--template-url=}"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "ERROR: unexpected argument: $1" >&2; exit 1 ;;
  esac
done

for cmd in jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd is not installed on PATH" >&2
    exit 1
  fi
done

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
APPLY_SCRIPT="$SCRIPT_DIR/jfrog-project-create-from-template.sh"
SCHEMA_FILE="$SCRIPT_DIR/../../jfrog/assets/project-templates/schema.json"

WORKDIR=$(mktemp -d -t jfrog-project-validate.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT
TEMPLATE_PATH="$WORKDIR/template.json"
ERRORS_FILE="$WORKDIR/errors.txt"
WARNINGS_FILE="$WORKDIR/warnings.txt"
: >"$ERRORS_FILE" >"$WARNINGS_FILE"

SERVER_FLAG=()
if [[ -n "$SERVER_ID" ]]; then SERVER_FLAG=(--server-id="$SERVER_ID"); fi

err()  { echo "ERROR: $*" >>"$ERRORS_FILE";   echo "ERROR: $*" >&2; }
warn() { echo "WARN:  $*" >>"$WARNINGS_FILE"; echo "WARN:  $*" >&2; }

# ---------------------------------------------------------------------------
# Ingest template (stdin or --template-url)
# ---------------------------------------------------------------------------

if [[ -n "$TEMPLATE_URL" ]]; then
  if ! command -v jf >/dev/null 2>&1; then
    echo "ERROR: --template-url requires jf CLI" >&2
    exit 1
  fi
  if ! jf api "$TEMPLATE_URL" "${SERVER_FLAG[@]}" >"$TEMPLATE_PATH" 2>"$WORKDIR/fetch.err"; then
    echo "ERROR: failed to fetch template from $TEMPLATE_URL" >&2
    cat "$WORKDIR/fetch.err" >&2 || true
    exit 1
  fi
else
  if [[ -t 0 ]]; then
    echo "ERROR: no template on stdin and --template-url not set" >&2
    echo "Usage: echo \"\$JSON\" | $0 [--check-platform] [--server-id <id>]" >&2
    exit 1
  fi
  cat - >"$TEMPLATE_PATH"
fi

if [[ ! -s "$TEMPLATE_PATH" ]]; then
  echo "ERROR: template input is empty" >&2
  exit 1
fi

if ! jq -e . "$TEMPLATE_PATH" >/dev/null 2>&1; then
  err "Template is not valid JSON"
  echo '{"valid": false, "errors": ["template is not valid JSON"]}'
  exit 2
fi

# ---------------------------------------------------------------------------
# Optional ajv schema validation
# ---------------------------------------------------------------------------

if command -v ajv >/dev/null 2>&1 && [[ -f "$SCHEMA_FILE" ]]; then
  AJV_OUT="$WORKDIR/ajv.txt"
  if ajv validate -s "$SCHEMA_FILE" -d "$TEMPLATE_PATH" >"$AJV_OUT" 2>&1; then
    :
  else
    err "Schema validation failed (ajv):"
    while IFS= read -r line; do err "  $line"; done <"$AJV_OUT"
  fi
elif [[ ! -f "$SCHEMA_FILE" ]]; then
  warn "Schema file not found at $SCHEMA_FILE — skipping ajv validation"
else
  warn "ajv not installed — skipping JSON-Schema validation. Run \`npm install -g ajv-cli\` for full coverage. Manual checks below cover the most important constraints."
fi

# ---------------------------------------------------------------------------
# Manual structural checks (always run, complement to ajv)
# ---------------------------------------------------------------------------

require_field() {
  local jq_path="$1"
  local human="$2"
  local val
  val=$(jq -r "$jq_path // empty" "$TEMPLATE_PATH")
  if [[ -z "$val" ]]; then
    err "$human is missing"
    return 1
  fi
  return 0
}

TV=$(jq -r '.template_version // empty' "$TEMPLATE_PATH")
if [[ -z "$TV" ]]; then
  err "template_version is missing"
elif ! [[ "$TV" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
  err "template_version '$TV' is not a valid semver-like string"
fi

require_field '.project.key'           'project.key'           || true
require_field '.project.display_name'  'project.display_name'  || true

PK=$(jq -r '.project.key // empty' "$TEMPLATE_PATH")
if [[ -n "$PK" ]] && ! [[ "$PK" =~ ^[a-z][a-z0-9-]{0,30}[a-z0-9]$ ]]; then
  err "project.key '$PK' violates the naming rule (2-32 chars, lowercase alphanumeric and hyphens, must start with a letter, no leading/trailing hyphen)"
fi

for flag in manage_members manage_resources index_resources; do
  v=$(jq -r "if (.project.admin_privileges // {} | has(\"$flag\")) then (.project.admin_privileges.$flag | tostring) else \"missing\" end" "$TEMPLATE_PATH")
  if [[ "$v" != "true" && "$v" != "false" ]]; then
    err "project.admin_privileges.$flag must be a boolean (got: $v)"
  fi
done

QG=$(jq -r '.project.quota_gb // empty' "$TEMPLATE_PATH")
if [[ -n "$QG" ]]; then
  if ! [[ "$QG" =~ ^[0-9]+$ ]] || [[ "$QG" -lt 1 ]]; then
    err "project.quota_gb must be a positive integer or null/omitted (got: $QG)"
  elif [[ "$QG" -ge 100000 ]]; then
    warn "project.quota_gb=$QG looks unusually large — confirm the unit is GB"
  fi
fi

ADMIN_USERS=$(jq -r '.admins.users  // [] | length' "$TEMPLATE_PATH")
ADMIN_GROUPS=$(jq -r '.admins.groups // [] | length' "$TEMPLATE_PATH")
if [[ "$ADMIN_USERS" -eq 0 && "$ADMIN_GROUPS" -eq 0 ]]; then
  warn "No project admins configured (admins.users and admins.groups are both empty). The Platform Admin who creates the project remains the only admin."
fi
if [[ "$ADMIN_USERS" -gt 0 && "$ADMIN_GROUPS" -eq 0 ]]; then
  warn "Project admins are individual users only. Best practice is to use a group so admin assignment survives staff churn."
fi

ROLE_COUNT=$(jq '.roles // [] | length' "$TEMPLATE_PATH")
for ((i=0; i<ROLE_COUNT; i++)); do
  RNAME=$(jq -r ".roles[$i].name // empty" "$TEMPLATE_PATH")
  RTYPE=$(jq -r ".roles[$i].type // empty" "$TEMPLATE_PATH")
  if [[ -z "$RNAME" ]]; then
    err "roles[$i].name is missing"; continue
  fi
  case "$RTYPE" in
    PREDEFINED|CUSTOM|ADMIN) ;;
    "") err "roles[$i].type is missing for role '$RNAME'" ;;
    *)  err "roles[$i].type must be PREDEFINED, CUSTOM, or ADMIN (got: $RTYPE)" ;;
  esac
  if [[ "$RTYPE" == "CUSTOM" ]]; then
    ENV_COUNT=$(jq ".roles[$i].environments // [] | length" "$TEMPLATE_PATH")
    ACT_COUNT=$(jq ".roles[$i].actions      // [] | length" "$TEMPLATE_PATH")
    if [[ "$ENV_COUNT" -eq 0 ]]; then
      err "CUSTOM role '$RNAME' must declare at least one environment"
    fi
    if [[ "$ACT_COUNT" -eq 0 ]]; then
      err "CUSTOM role '$RNAME' must declare at least one action"
    fi
  fi
done

MEMBER_COUNT=$(jq '.members // [] | length' "$TEMPLATE_PATH")
for ((i=0; i<MEMBER_COUNT; i++)); do
  HAS_USER=$(jq  ".members[$i] | has(\"user\")"  "$TEMPLATE_PATH")
  HAS_GROUP=$(jq ".members[$i] | has(\"group\")" "$TEMPLATE_PATH")
  ROLE_LEN=$(jq  ".members[$i].roles // [] | length" "$TEMPLATE_PATH")
  if [[ "$HAS_USER" == "true" && "$HAS_GROUP" == "true" ]]; then
    err "members[$i] has both 'user' and 'group' (must have exactly one)"
  elif [[ "$HAS_USER" == "false" && "$HAS_GROUP" == "false" ]]; then
    err "members[$i] has neither 'user' nor 'group' (must have exactly one)"
  fi
  if [[ "$ROLE_LEN" -eq 0 ]]; then
    err "members[$i].roles must contain at least one role"
  fi
done

HAS_OIDC=$(jq 'has("oidc") and (.oidc != null)' "$TEMPLATE_PATH")
if [[ "$HAS_OIDC" == "true" ]]; then
  for f in name issuer_url provider_type; do
    v=$(jq -r ".oidc.provider.$f // empty" "$TEMPLATE_PATH")
    if [[ -z "$v" ]]; then err "oidc.provider.$f is missing"; fi
  done
  PT=$(jq -r '.oidc.provider.provider_type // empty' "$TEMPLATE_PATH")
  case "$PT" in
    github|gitlab|generic|"") ;;
    *) warn "oidc.provider.provider_type='$PT' is not in the documented set (github, gitlab, generic). The platform may still accept it on newer versions." ;;
  esac
  ISSUER=$(jq -r '.oidc.provider.issuer_url // empty' "$TEMPLATE_PATH")
  if [[ -n "$ISSUER" ]] && ! [[ "$ISSUER" =~ ^https?:// ]]; then
    err "oidc.provider.issuer_url '$ISSUER' must be an http(s) URL"
  fi
  MCOUNT=$(jq '.oidc.identity_mappings // [] | length' "$TEMPLATE_PATH")
  for ((i=0; i<MCOUNT; i++)); do
    MN=$(jq -r ".oidc.identity_mappings[$i].name // empty" "$TEMPLATE_PATH")
    if [[ -z "$MN" ]]; then err "oidc.identity_mappings[$i].name is missing"; fi
    CKEYS=$(jq ".oidc.identity_mappings[$i].claims // {} | length" "$TEMPLATE_PATH")
    if [[ "$CKEYS" -eq 0 ]]; then
      err "oidc.identity_mappings[$i].claims must contain at least one claim filter"
    fi
    SCOPE=$(jq -r ".oidc.identity_mappings[$i].token_spec.scope // empty" "$TEMPLATE_PATH")
    if [[ -z "$SCOPE" ]]; then
      err "oidc.identity_mappings[$i].token_spec.scope is missing"
    elif ! [[ "$SCOPE" =~ ^applied-permissions/(admin|user|groups:.+)$ ]]; then
      err "oidc.identity_mappings[$i].token_spec.scope '$SCOPE' is not a valid JFrog scope"
    elif [[ "$SCOPE" == "applied-permissions/admin" ]]; then
      warn "oidc.identity_mappings[$i] uses applied-permissions/admin — avoid platform-admin scope for CI tokens"
    fi
    EXP=$(jq -r ".oidc.identity_mappings[$i].token_spec.expires_in // empty" "$TEMPLATE_PATH")
    if [[ -n "$EXP" ]] && [[ "$EXP" -gt 3600 ]]; then
      warn "oidc.identity_mappings[$i].token_spec.expires_in=$EXP exceeds one hour — keep CI tokens short"
    fi
  done
fi

ROLE_NAMES=$(jq -r '[.roles // [] | .[].name] | join("\n")' "$TEMPLATE_PATH")
PREDEFINED_ROLES=("Project Admin" "Developer" "Contributor" "Viewer" "Release Manager" "Security Manager" "AppTrust Manager" "Model Governor" "Model Developer")
for ((i=0; i<MEMBER_COUNT; i++)); do
  RC=$(jq ".members[$i].roles | length" "$TEMPLATE_PATH")
  for ((j=0; j<RC; j++)); do
    RN=$(jq -r ".members[$i].roles[$j]" "$TEMPLATE_PATH")
    found=0
    if [[ -n "$ROLE_NAMES" ]] && grep -Fxq "$RN" <<<"$ROLE_NAMES"; then found=1; fi
    if [[ "$found" -eq 0 ]]; then
      for pre in "${PREDEFINED_ROLES[@]}"; do
        if [[ "$pre" == "$RN" ]]; then found=1; break; fi
      done
    fi
    if [[ "$found" -eq 0 ]]; then
      warn "members[$i] references role '$RN' which is neither declared in roles[] nor a known predefined role. Add it to roles[] (PREDEFINED or CUSTOM) for clarity."
    fi
  done
done

# ---------------------------------------------------------------------------
# Optional --check-platform: delegate to apply --dry-run via stdin
# ---------------------------------------------------------------------------

PLATFORM_REPORT_FILE=""
if (( CHECK_PLATFORM == 1 )); then
  if [[ ! -x "$APPLY_SCRIPT" ]]; then
    warn "--check-platform skipped: apply script not found at $APPLY_SCRIPT"
  elif ! command -v jf >/dev/null 2>&1; then
    warn "--check-platform skipped: jf CLI not installed"
  else
    PLATFORM_REPORT_FILE="$WORKDIR/platform-report.json"
    set +e
    if [[ -n "$SERVER_ID" ]]; then
      "$APPLY_SCRIPT" --server-id "$SERVER_ID" --dry-run \
        <"$TEMPLATE_PATH" \
        >"$PLATFORM_REPORT_FILE" 2>"$WORKDIR/platform-err.log"
    else
      "$APPLY_SCRIPT" --dry-run \
        <"$TEMPLATE_PATH" \
        >"$PLATFORM_REPORT_FILE" 2>"$WORKDIR/platform-err.log"
    fi
    APPLY_RC=$?
    set -e
    if [[ "$APPLY_RC" -ne 0 ]]; then
      err "Platform dry-run reported issues (see report); exit $APPLY_RC"
    fi
    if jq -e . "$PLATFORM_REPORT_FILE" >/dev/null 2>&1; then
      while IFS= read -r w; do warn "platform: $w"; done < <(jq -r '.warnings[]?' "$PLATFORM_REPORT_FILE")
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

ERROR_COUNT=$(wc -l <"$ERRORS_FILE"  | tr -d ' ')
WARN_COUNT=$( wc -l <"$WARNINGS_FILE" | tr -d ' ')

VALID=$([[ "$ERROR_COUNT" -eq 0 ]] && echo true || echo false)

REPORT=$(jq -n \
  --arg schema_version "2.0" \
  --arg input_source "$([[ -n "$TEMPLATE_URL" ]] && echo template-url || echo stdin)" \
  --arg template_url "$TEMPLATE_URL" \
  --argjson valid "$VALID" \
  --slurpfile platform <(if [[ -n "$PLATFORM_REPORT_FILE" && -f "$PLATFORM_REPORT_FILE" ]]; then cat "$PLATFORM_REPORT_FILE"; else echo "null"; fi) \
  --rawfile errors_text   "$ERRORS_FILE" \
  --rawfile warnings_text "$WARNINGS_FILE" \
  '
    {
      schema_version: $schema_version,
      input_source: $input_source,
      template_url: (if $template_url == "" then null else $template_url end),
      valid: $valid,
      errors:   ($errors_text   | split("\n") | map(select(. != "")) | map(sub("^ERROR: "; ""))),
      warnings: ($warnings_text | split("\n") | map(select(. != "")) | map(sub("^WARN:  "; ""))),
      platform_dry_run: $platform[0]
    }
  ')

echo "$REPORT"

if [[ "$VALID" == "true" ]]; then
  echo "Template OK ($WARN_COUNT warning(s))" >&2
  exit 0
else
  echo "Template has $ERROR_COUNT error(s) and $WARN_COUNT warning(s)" >&2
  exit 2
fi
