#!/usr/bin/env bash
# list-skill-policies.sh — deterministic listing of the AI Catalog governance
# policies (project-scoped + Global, merged) that apply to skills in one
# project. Owns everything from here down: the query, auto-pagination,
# rendering, and scrubbing any internal service detail out of a failure —
# none of that is left to the calling agent.
#
# Usage:
#   list-skill-policies.sh --project <PROJECT> --server-id <SID>
#
# stdout (exit 0): finished text to present verbatim — either the intro line
#   plus markdown table, or the one-line "no policies" fallback. Never raw
#   JSON; the caller does no parsing.
# stderr + exit 1: the call, or the response it returned, could not be used.
#   stderr is one line, already safe to present verbatim — the internal
#   service name, its path, the query string, and any Trace ID are always
#   scrubbed before this script ever prints an error. This is a hard
#   invariant: every exit path past argument parsing goes through the same
#   scrubbed-message helper, so a malformed response can never fall through
#   to a raw, unscrubbed shell/jq error (see fail()).
# exit 2: usage error (missing --project/--server-id).
#
# Calls the AI Catalog policy engine directly via `jf api`, on the JPD
# itself — never the browser-session gateway path — the same door the
# waiver flow already uses.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../jfrog/scripts/lib/jf-api-http-status.sh
source "$SCRIPT_DIR/../../jfrog/scripts/lib/jf-api-http-status.sh"

PROJECT=""
SID=""
OUT_FILE=""
ERR_FILE=""
ACC_FILE=""
trap 'rm -f "${OUT_FILE:-}" "${ERR_FILE:-}" "${ACC_FILE:-}" "${ACC_FILE:-}.new"' EXIT

# fail is the ONLY way this script reports a runtime (non-usage) failure, so
# scrubbing lives in exactly one place. err_file, if given, is jf api's own
# stderr — parsed for an HTTP status (never re-printed raw). Never call this
# with anything that might itself contain the service name, its path, the
# query string, or a Trace ID; it does not scrub its own $2.
fail() {
  local reason="$1" err_file="${2:-}" status=0
  if [[ -n "$err_file" && -f "$err_file" ]]; then
    status="$(jf_api_http_status "$err_file")"
  fi
  if [[ "$status" != "0" ]]; then
    echo "Listing AI Catalog policies failed (HTTP ${status}): ${reason}" >&2
  else
    echo "Listing AI Catalog policies failed: ${reason}" >&2
  fi
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --server-id) SID="${2:-}"; shift 2 ;;
    *) echo "list-skill-policies.sh: unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PROJECT" || -z "$SID" ]]; then
  echo "usage: list-skill-policies.sh --project <PROJECT> --server-id <SID>" >&2
  exit 2
fi

# Bounded, not browsable: this answer must be complete, so pages are fetched
# silently up to a generous safety cap rather than asked about one at a time.
# If the cap is ever actually hit, that's flagged below rather than silently
# presenting a partial list as the complete one.
PAGE_LIMIT=250
MAX_PAGES=8

OUT_FILE="$(mktemp)"
ERR_FILE="$(mktemp)"
ACC_FILE="$(mktemp)"
echo '[]' >"$ACC_FILE"

offset=0
truncated=false
for ((page = 0; page < MAX_PAGES; page++)); do
  if ! jf api "/unifiedpolicy/api/v1/policies?action_type=use_skill&project_key=${PROJECT}&hierarchical=true&expand=rules&limit=${PAGE_LIMIT}&offset=${offset}" \
      --server-id "$SID" >"$OUT_FILE" 2>"$ERR_FILE"; then
    clean_err="$(grep -vF 'Trace ID' "$ERR_FILE" \
      | sed -E 's#https?://[^[:space:]]*/unifiedpolicy/[^[:space:]]*#the AI Catalog policy engine#g; s#/unifiedpolicy/[^[:space:]]*#the AI Catalog policy engine#g' \
      | tail -1)"
    [[ -z "$clean_err" ]] && clean_err="the AI Catalog policy engine returned an error"
    fail "$clean_err" "$ERR_FILE"
  fi

  # The call reported success, but that alone does not make the body usable —
  # validate before any jq call touches it, so a malformed/truncated 2xx body
  # is reported the same clean way as a network failure, never as a raw
  # jq parse error breaking this script's own exit-code contract.
  if ! jq -e . "$OUT_FILE" >/dev/null 2>&1; then
    fail "the AI Catalog policy engine returned an unreadable response"
  fi

  if ! jq -s '.[0] + (.[1].items // [])' "$ACC_FILE" "$OUT_FILE" >"${ACC_FILE}.new" 2>/dev/null; then
    fail "the AI Catalog policy engine returned an unreadable response"
  fi
  mv "${ACC_FILE}.new" "$ACC_FILE"

  page_size="$(jq -r '.page_size // 0' "$OUT_FILE" 2>/dev/null || echo 0)"
  if (( page_size < PAGE_LIMIT )); then
    break
  fi
  if (( page + 1 == MAX_PAGES )); then
    truncated=true
  fi
  offset=$((offset + PAGE_LIMIT))
done

count="$(jq 'length' "$ACC_FILE" 2>/dev/null || echo 0)"
if [[ "$count" -eq 0 ]]; then
  # Deliberately one generic line: an empty result is indistinguishable, at
  # this API, from "you can't see this project's policies" — do not guess
  # at which one it is (see references/listing-policies.md).
  echo "No AI Catalog policies apply to project \`${PROJECT}\`."
  exit 0
fi

echo "AI Catalog policies affecting skills in project \`${PROJECT}\`:"
echo
echo '| Policy | Scope | Rule type | Action | Condition |'
echo '|--------|-------|-----------|--------|-----------|'
jq -r '
  sort_by(.name)[] |
  (if .scope.type == "global" then "Global" else "Project" end) as $scope |
  (if .mode == "block" then "Block"
   elif (.mode == "warning" or .mode == "warn") then "Warn"
   else (.mode // "—") end) as $action |
  ((.rules // []) | length) as $ruleCount |
  ((.rules[0].template.name) // "—") as $ruleTypeBase |
  (if $ruleCount > 1 then "\($ruleTypeBase) (+\($ruleCount - 1) more)" else $ruleTypeBase end) as $ruleType |
  ((.rules[0].template.description) // "—") as $condition |
  "| `\(.name)` | \($scope) | \($ruleType) | \($action) | \($condition) |"
' "$ACC_FILE"

if [[ "$truncated" == "true" ]]; then
  echo
  echo "(Showing the first $((MAX_PAGES * PAGE_LIMIT)) policies; more may apply to this project.)"
fi
