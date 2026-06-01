#!/usr/bin/env bash
# onboard-from-base.sh — Replicate an existing project's shape into a new
# project by fetching its template, substituting the project key (plus
# display name and optional OIDC source repo), and piping the rendered JSON
# to the jfrog-project-setup apply scripts.
#
# This is a FORKABLE REFERENCE, not a first-class skill script. Copy it
# into your onboarding repo and adapt the substitution rules to your
# org's naming conventions if needed. The `jfrog-project-setup` skill
# points users at this script when they want to onboard another team
# using the same shape as an existing project; the agent never invokes
# it automatically.
#
# Usage:
#   onboard-from-base.sh --base-url <artifactory-path>
#                        --key <new-key>
#                        --display "<display-name>"
#                        [--source-repo <org/repo>]
#                        [--server-id <id>]
#                        [--render-only | --dry-run]
#                        [--skip-phase-3-4]
#                        [--audit]
#
#   cat base.json | onboard-from-base.sh --from-stdin
#                                        --key <new-key>
#                                        --display "<display-name>"
#                                        [<options>]
#
# Required input (exactly one of):
#   --base-url <path>      Artifactory path to the base template
#                          (e.g. /artifactory/project-templates-generic-local/fin-1042.json).
#                          Fetched via `jf api`.
#   --from-stdin           Read base template JSON from stdin.
#
# Required values:
#   --key <new-key>        New project key. Must satisfy
#                          ^[a-z][a-z0-9-]{0,30}[a-z0-9]$  (2-32 chars,
#                          lowercase + hyphens, starts with a letter).
#   --display "<text>"     Display name for the new project (1-64 chars).
#
# Optional:
#   --source-repo <org/repo>
#                          Substituted into every
#                          .oidc.identity_mappings[].claims.repository
#                          (only relevant when the base has an `oidc` block).
#   --server-id <id>       Passed to `jf api` for the base fetch and to
#                          both apply scripts.
#   --render-only          Print rendered template JSON to stdout; do not
#                          invoke the apply scripts. Useful for review,
#                          PR diffing, or piping the rendered template
#                          into `jf api ... -X PUT --input -` to seed the
#                          templates repo's per-project tier.
#   --dry-run              Pass --dry-run to the apply scripts so they
#                          report what they would do without mutating.
#   --skip-phase-3-4       Apply only Phase 1+2; skip the repo-structure
#                          apply even if the template has `stages` /
#                          `repositories` / `external_stage_rbac` /
#                          `sharing` sections.
#   --audit                Pass --audit to the apply scripts so each
#                          successful apply records the rendered template
#                          in the templates repo's `applied/` folder.
#   -h, --help             Show this help.
#
# Substitution model:
#   1. Word-boundary substitution rewrites every string in the document
#      where the old `project.key` appears as a whole word. This covers
#      `project.key`, group names that contain the key by convention
#      (e.g. `<key>-developers`), the OIDC provider `name`, and any
#      `applied-permissions/groups:<key>-...` scope strings.
#   2. `project.display_name` is overridden with the value from --display.
#   3. If the base has an `oidc.identity_mappings[]` array and
#      --source-repo is set, every `claims.repository` is overridden.
#
# Word-boundary substitution is safe for the conventional key shape
# (`fin-1042`, `team-x`, etc.) and will NOT match `fin` inside `final`
# or `team` inside `teams`. Customers using bare-prefix keys should
# pick longer, less-ambiguous identifiers; the project-key regex
# above already enforces this for new projects.
#
# What this script never does:
#   - Edit the bundled blueprints in skills/jfrog/assets/project-templates/.
#   - Write the rendered template to local disk by itself. With
#     --render-only the customer captures stdout; otherwise the rendered
#     JSON travels only through stdin into the apply scripts.
#   - Create groups, users, or source code repositories. Those must
#     already exist; the apply scripts surface `principal_missing`
#     otherwise.
#   - Rename an existing project. Project keys are immutable on JFrog.
#     Re-running with a NEW_KEY that already exists on the platform
#     will report `already_exists` (or drift updates) per resource.
#
# Exit codes:
#   0  Rendered + applied (or dry-run / render-only) successfully.
#   1  Usage / fetch / render error (no apply attempted).
#   2  One or more apply phases produced errors; wrapper outcome JSON
#      still emitted on stdout.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY_PHASE_1_2="$SCRIPT_DIR/../scripts/jfrog-project-create-from-template.sh"
APPLY_PHASE_3_4="$SCRIPT_DIR/../scripts/jfrog-project-apply-repo-structure.sh"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

BASE_URL=""
FROM_STDIN=0
NEW_KEY=""
NEW_DISPLAY=""
SOURCE_REPO=""
SERVER_ID=""
RENDER_ONLY=0
DRY_RUN=0
SKIP_PHASE_3_4=0
AUDIT=0

print_help() {
  sed -n '2,90p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)     BASE_URL="${2:-}"; shift 2 ;;
    --base-url=*)   BASE_URL="${1#--base-url=}"; shift ;;
    --from-stdin)   FROM_STDIN=1; shift ;;
    --key)          NEW_KEY="${2:-}"; shift 2 ;;
    --key=*)        NEW_KEY="${1#--key=}"; shift ;;
    --display)      NEW_DISPLAY="${2:-}"; shift 2 ;;
    --display=*)    NEW_DISPLAY="${1#--display=}"; shift ;;
    --source-repo)  SOURCE_REPO="${2:-}"; shift 2 ;;
    --source-repo=*) SOURCE_REPO="${1#--source-repo=}"; shift ;;
    --server-id)    SERVER_ID="${2:-}"; shift 2 ;;
    --server-id=*)  SERVER_ID="${1#--server-id=}"; shift ;;
    --render-only)  RENDER_ONLY=1; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --skip-phase-3-4) SKIP_PHASE_3_4=1; shift ;;
    --audit)        AUDIT=1; shift ;;
    -h|--help)      print_help; exit 0 ;;
    *)
      echo "ERROR: unexpected argument: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

err() { echo "ERROR: $*" >&2; exit 1; }

if (( FROM_STDIN == 1 )) && [[ -n "$BASE_URL" ]]; then
  err "--base-url and --from-stdin are mutually exclusive"
fi
if (( FROM_STDIN == 0 )) && [[ -z "$BASE_URL" ]]; then
  err "exactly one of --base-url or --from-stdin is required"
fi
[[ -n "$NEW_KEY" ]]     || err "--key is required"
[[ -n "$NEW_DISPLAY" ]] || err "--display is required"

if [[ ! "$NEW_KEY" =~ ^[a-z][a-z0-9-]{0,30}[a-z0-9]$ ]]; then
  err "--key '$NEW_KEY' violates the project-key rule (2-32 chars, lowercase + hyphens, must start with a letter, no leading/trailing hyphen)"
fi
if [[ "${#NEW_DISPLAY}" -gt 64 ]]; then
  err "--display value is longer than 64 chars"
fi

if (( RENDER_ONLY == 1 )) && (( DRY_RUN == 1 )); then
  err "--render-only and --dry-run are mutually exclusive"
fi

for cmd in jq jf; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "$cmd is not installed on PATH"
  fi
done

# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------

WORKDIR=$(mktemp -d -t onboard-from-base.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT
BASE_FILE="$WORKDIR/base.json"
RENDERED_FILE="$WORKDIR/rendered.json"
P12_OUTCOME="$WORKDIR/phase-1-2.outcome.json"
P34_OUTCOME="$WORKDIR/phase-3-4.outcome.json"

SERVER_FLAG=()
if [[ -n "$SERVER_ID" ]]; then
  SERVER_FLAG=(--server-id="$SERVER_ID")
fi

# ---------------------------------------------------------------------------
# Step 1 — Fetch base template
# ---------------------------------------------------------------------------

if (( FROM_STDIN == 1 )); then
  if [[ -t 0 ]]; then
    err "--from-stdin set but stdin is a terminal; pipe the base template in"
  fi
  cat - >"$BASE_FILE"
  BASE_SOURCE="stdin"
else
  if ! jf api "$BASE_URL" "${SERVER_FLAG[@]+"${SERVER_FLAG[@]}"}" >"$BASE_FILE" 2>"$WORKDIR/fetch.err"; then
    echo "ERROR: failed to fetch base template from $BASE_URL" >&2
    cat "$WORKDIR/fetch.err" >&2 || true
    exit 1
  fi
  BASE_SOURCE="$BASE_URL"
fi

if [[ ! -s "$BASE_FILE" ]]; then
  err "base template is empty"
fi
if ! jq -e . "$BASE_FILE" >/dev/null 2>&1; then
  err "base template is not valid JSON"
fi

OLD_KEY=$(jq -r '.project.key // empty' "$BASE_FILE")
if [[ -z "$OLD_KEY" ]]; then
  err "base template has no .project.key (cannot derive substitution source)"
fi
if [[ "$OLD_KEY" == "$NEW_KEY" ]]; then
  err "--key matches the base template's .project.key ('$OLD_KEY'); this would be a no-op"
fi

TPL_VERSION=$(jq -r '.template_version // empty' "$BASE_FILE")
if [[ -z "$TPL_VERSION" || "${TPL_VERSION%%.*}" != "1" ]]; then
  err "base template_version '$TPL_VERSION' is not 1.x; this envelope tracks the 1.x schema"
fi

# Count strings in the base that contain OLD_KEY as a whole word; this is
# what the wrapper outcome reports as `substitutions`. We compute it pre-
# render so the count reflects the input rather than the rendered output.
SUB_COUNT=$(jq -r --arg old "$OLD_KEY" '[.. | strings | select(test("\\b" + $old + "\\b"))] | length' "$BASE_FILE")

HAS_OIDC=$(jq -r 'if has("oidc") and (.oidc != null) then "true" else "false" end' "$BASE_FILE")
OIDC_MAPPING_COUNT=$(jq -r '.oidc.identity_mappings // [] | length' "$BASE_FILE")
HAS_PHASE_3_4=$(jq -r '
  if (has("stages") and ((.stages // []) | length > 0))
     or (has("repositories") and ((.repositories // []) | length > 0))
     or has("external_stage_rbac")
     or (has("sharing") and ((.sharing // []) | length > 0))
  then "true" else "false" end' "$BASE_FILE")

if [[ "$HAS_OIDC" == "true" && "$OIDC_MAPPING_COUNT" -gt 0 && -z "$SOURCE_REPO" ]]; then
  err "base template has oidc.identity_mappings but --source-repo was not set; refusing to leave the previous project's source repo in the new template"
fi

# ---------------------------------------------------------------------------
# Step 2 — Render
# ---------------------------------------------------------------------------

# Word-boundary substitution everywhere, then targeted overrides. The
# overrides use the new key, so they have to run after the gsub pass.
jq \
  --arg old "$OLD_KEY" \
  --arg new "$NEW_KEY" \
  --arg disp "$NEW_DISPLAY" \
  --arg src "$SOURCE_REPO" \
  '
    (.. | strings) |= gsub("\\b" + $old + "\\b"; $new)
    | .project.display_name = $disp
    | (if has("oidc") and (.oidc != null) and ($src != "") then
        .oidc.identity_mappings |= (
          map(if has("claims") and (.claims | has("repository"))
              then .claims.repository = $src
              else . end)
        )
      else . end)
  ' "$BASE_FILE" >"$RENDERED_FILE"

# Sanity-check the rendered key.
RENDERED_KEY=$(jq -r '.project.key // empty' "$RENDERED_FILE")
if [[ "$RENDERED_KEY" != "$NEW_KEY" ]]; then
  err "post-render project.key '$RENDERED_KEY' does not match --key '$NEW_KEY' (substitution failed; report this as a bug)"
fi

# ---------------------------------------------------------------------------
# Step 3 — Branch on mode
# ---------------------------------------------------------------------------

if (( RENDER_ONLY == 1 )); then
  cat "$RENDERED_FILE"
  exit 0
fi

APPLY_FLAGS=()
(( DRY_RUN == 1 )) && APPLY_FLAGS+=(--dry-run)
(( AUDIT   == 1 )) && APPLY_FLAGS+=(--audit)
[[ -n "$SERVER_ID" ]] && APPLY_FLAGS+=(--server-id="$SERVER_ID")

mode="apply"
(( DRY_RUN == 1 )) && mode="dry_run"

# ---------------------------------------------------------------------------
# Step 4 — Pipe to Phase 1+2 apply
# ---------------------------------------------------------------------------

if [[ ! -x "$APPLY_PHASE_1_2" ]]; then
  err "Phase 1+2 apply script not executable at $APPLY_PHASE_1_2"
fi

set +e
"$APPLY_PHASE_1_2" "${APPLY_FLAGS[@]+"${APPLY_FLAGS[@]}"}" <"$RENDERED_FILE" >"$P12_OUTCOME" 2>"$WORKDIR/phase-1-2.err"
P12_RC=$?
set -e

# ---------------------------------------------------------------------------
# Step 5 — Pipe to Phase 3+4 apply (when relevant)
# ---------------------------------------------------------------------------

run_phase_3_4="false"
if (( SKIP_PHASE_3_4 == 0 )) && [[ "$HAS_PHASE_3_4" == "true" ]] && (( P12_RC <= 2 )); then
  # P12_RC 0 = clean apply; 2 = errors but outcome JSON still written.
  # We continue to Phase 3+4 only when Phase 1+2 produced a structured
  # outcome (rc 0 or 2). On rc 1 the apply script bailed before doing
  # anything, so a Phase 3+4 attempt would also fail; skip it.
  if [[ "$P12_RC" -eq 0 ]] || [[ "$P12_RC" -eq 2 ]]; then
    if [[ ! -x "$APPLY_PHASE_3_4" ]]; then
      err "Phase 3+4 apply script not executable at $APPLY_PHASE_3_4"
    fi
    run_phase_3_4="true"
    set +e
    "$APPLY_PHASE_3_4" "${APPLY_FLAGS[@]+"${APPLY_FLAGS[@]}"}" <"$RENDERED_FILE" >"$P34_OUTCOME" 2>"$WORKDIR/phase-3-4.err"
    P34_RC=$?
    set -e
  fi
fi

# ---------------------------------------------------------------------------
# Step 6 — Wrapper outcome JSON
# ---------------------------------------------------------------------------

# Read each phase's outcome JSON if it exists and is parseable; otherwise
# emit a minimal "the apply script bailed" record with the captured stderr.
phase_block() {
  local outcome_file="$1"
  local rc_var="$2"
  local err_file="$3"
  local ran="$4"
  if [[ "$ran" == "false" ]]; then
    jq -nc --arg reason "skipped" '{ran: false, reason: $reason}'
    return
  fi
  local rc="${!rc_var:-0}"
  if [[ -s "$outcome_file" ]] && jq -e . "$outcome_file" >/dev/null 2>&1; then
    jq -c --argjson rc "$rc" '. + {exit_code: $rc}' "$outcome_file"
  else
    jq -nc --argjson rc "$rc" --rawfile stderr "$err_file" \
      '{ran: true, exit_code: $rc, error: "apply_script_bailed_before_outcome", stderr: $stderr}'
  fi
}

P12_BLOCK=$(phase_block "$P12_OUTCOME" P12_RC "$WORKDIR/phase-1-2.err" "true")
P34_BLOCK=$(phase_block "$P34_OUTCOME" P34_RC "$WORKDIR/phase-3-4.err" "$run_phase_3_4")

jq -nc \
  --arg tool "onboard-from-base" \
  --arg schema_version "1.0" \
  --arg base_source "$BASE_SOURCE" \
  --arg from_key "$OLD_KEY" \
  --arg to_key "$NEW_KEY" \
  --argjson substitutions "$SUB_COUNT" \
  --arg display_name "$NEW_DISPLAY" \
  --arg source_repo "$SOURCE_REPO" \
  --arg mode "$mode" \
  --argjson phase_1_2 "$P12_BLOCK" \
  --argjson phase_3_4 "$P34_BLOCK" \
  '{
    tool: $tool,
    schema_version: $schema_version,
    instantiated: {
      base_source: $base_source,
      from_key: $from_key,
      to_key: $to_key,
      substitutions: $substitutions,
      display_name: $display_name,
      source_repo: (if $source_repo == "" then null else $source_repo end)
    },
    mode: $mode,
    phase_1_2: $phase_1_2,
    phase_3_4: $phase_3_4
  }'

# ---------------------------------------------------------------------------
# Step 7 — Exit code
# ---------------------------------------------------------------------------

# Mirror the apply scripts' contract: 0 clean, 2 errors-in-outcome.
worst=0
[[ "$P12_RC" -gt "$worst" ]] && worst="$P12_RC"
if [[ "$run_phase_3_4" == "true" ]]; then
  [[ "${P34_RC:-0}" -gt "$worst" ]] && worst="$P34_RC"
fi

case "$worst" in
  0) exit 0 ;;
  2) exit 2 ;;
  *) exit "$worst" ;;
esac
