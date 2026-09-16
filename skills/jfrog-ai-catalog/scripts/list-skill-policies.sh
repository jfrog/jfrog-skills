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
# stderr + exit 1: the underlying call failed. stderr is one line, already
#   safe to present verbatim — the internal service name, its path, the
#   query string, and any Trace ID are always scrubbed before this script
#   ever prints an error.
# exit 2: usage error (missing --project/--server-id).
#
# Calls the AI Catalog policy engine directly via `jf api`, on the JPD
# itself — never the browser-session gateway path — the same door the
# waiver flow already uses.

set -euo pipefail

PROJECT=""
SID=""
OUT_FILE=""
ERR_FILE=""
ACC_FILE=""
trap 'rm -f "${OUT_FILE:-}" "${ERR_FILE:-}" "${ACC_FILE:-}"' EXIT

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
PAGE_LIMIT=250
MAX_PAGES=8

OUT_FILE="$(mktemp)"
ERR_FILE="$(mktemp)"
ACC_FILE="$(mktemp)"
echo '[]' >"$ACC_FILE"

offset=0
for ((page = 0; page < MAX_PAGES; page++)); do
  if ! jf api "/unifiedpolicy/api/v1/policies?action_type=use_skill&project_key=${PROJECT}&hierarchical=true&expand=rules&limit=${PAGE_LIMIT}&offset=${offset}" \
      --server-id "$SID" >"$OUT_FILE" 2>"$ERR_FILE"; then
    # Scrub before this ever reaches stderr: no Trace ID, no internal path,
    # no query string — those must never be presented to the user verbatim.
    clean_err="$(grep -vF 'Trace ID' "$ERR_FILE" \
      | sed -E 's#https?://[^[:space:]]*/unifiedpolicy/[^[:space:]]*#the AI Catalog policy engine#g; s#/unifiedpolicy/[^[:space:]]*#the AI Catalog policy engine#g' \
      | tail -1)"
    [[ -z "$clean_err" ]] && clean_err="the AI Catalog policy engine returned an error"
    echo "Listing AI Catalog policies failed: ${clean_err}" >&2
    exit 1
  fi

  jq -s '.[0] + (.[1].items // [])' "$ACC_FILE" "$OUT_FILE" >"${ACC_FILE}.new"
  mv "${ACC_FILE}.new" "$ACC_FILE"

  page_size="$(jq -r '.page_size // 0' "$OUT_FILE")"
  if (( page_size < PAGE_LIMIT )); then
    break
  fi
  offset=$((offset + PAGE_LIMIT))
done

count="$(jq 'length' "$ACC_FILE")"
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
   else .mode end) as $action |
  ((.rules[0].template.name) // "—") as $ruleType |
  ((.rules[0].template.description) // "—") as $condition |
  "| `\(.name)` | \($scope) | \($ruleType) | \($action) | \($condition) |"
' "$ACC_FILE"
