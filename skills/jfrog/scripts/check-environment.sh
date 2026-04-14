#!/usr/bin/env bash
# check-environment.sh — Cached JFrog CLI environment check
#
# Checks if jf is installed and its version, using a 24h-TTL cache
# at <skill_path>/local-cache/jfrog-skill-state.json to avoid redundant checks.
# local-cache/ is only for this file and the OneModel schema cache — not temp API output.
#
# stdout: eval-able shell exports (JFROG_CLI_USER_AGENT)
# stderr: JSON state (informational, also written to cache file)
#
# Exit codes:
#   0 — Cache is fresh, CLI is ready
#   1 — Cache was stale/missing and has been refreshed
#   2 — jf is not installed
#
# Usage:
#   eval "$(bash check-environment.sh [--force])"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="$SKILL_ROOT/local-cache"
CACHE_FILE="$CACHE_DIR/jfrog-skill-state.json"
DEFAULT_TTL_HOURS=24
FORCE=false

if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

now_epoch() {
  date -u +%s
}

iso_now() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

is_cache_fresh() {
  if [[ ! -f "$CACHE_FILE" ]]; then
    return 1
  fi

  if ! command -v jq &>/dev/null; then
    return 1
  fi

  local checked_at ttl_hours checked_epoch now ttl_seconds age
  checked_at=$(jq -r '.checked_at // empty' "$CACHE_FILE" 2>/dev/null) || return 1
  ttl_hours=$(jq -r '.ttl_hours // 24' "$CACHE_FILE" 2>/dev/null) || return 1

  if [[ -z "$checked_at" ]]; then
    return 1
  fi

  # Parse ISO timestamp to epoch (portable: try GNU date, then BSD date)
  if checked_epoch=$(date -d "$checked_at" +%s 2>/dev/null); then
    : # GNU date succeeded
  elif checked_epoch=$(date -jf '%Y-%m-%dT%H:%M:%SZ' "$checked_at" +%s 2>/dev/null); then
    : # BSD date succeeded
  else
    return 1
  fi

  now=$(now_epoch)
  ttl_seconds=$((ttl_hours * 3600))
  age=$((now - checked_epoch))

  if (( age < ttl_seconds )); then
    return 0
  fi
  return 1
}

check_cli() {
  local cli_path cli_version

  if ! cli_path=$(command -v jf 2>/dev/null); then
    echo '{"cli_installed": false}' >&2
    return 2
  fi

  cli_version=$(jf --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")

  # Check for latest version (best-effort, non-blocking)
  local latest_version="unknown"
  if command -v curl &>/dev/null; then
    latest_version=$(curl -sf --max-time 5 "https://releases.jfrog.io/artifactory/jfrog-cli/v2-jf/" 2>/dev/null \
      | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sort -V | tail -1 || echo "unknown")
  fi

  mkdir -p "$CACHE_DIR"
  local state
  state=$(cat <<EOF
{
  "checked_at": "$(iso_now)",
  "ttl_hours": $DEFAULT_TTL_HOURS,
  "cli_installed": true,
  "cli_path": "$cli_path",
  "cli_version": "$cli_version",
  "latest_version_available": "$latest_version"
}
EOF
)
  echo "$state" > "$CACHE_FILE"
  echo "$state" >&2
  return 1
}

# Emit skill-level env vars to stdout (for eval by the caller)
emit_skill_env() {
  local skill_version cli_version
  # Parse version from SKILL.md YAML frontmatter (metadata.version)
  skill_version="$(awk '/^---$/{n++; next} n==1 && /^[[:space:]]*version:/{gsub(/["'"'"']/, "", $2); print $2; exit}' "$SKILL_ROOT/SKILL.md" 2>/dev/null | tr -d '[:space:]')"
  skill_version="${skill_version:-unknown}"
  cli_version=$(jq -r '.cli_version // "unknown"' "$CACHE_FILE" 2>/dev/null || echo "unknown")
  echo "export JFROG_CLI_USER_AGENT='jfrog-skills/${skill_version} jfrog-cli-go/${cli_version}'"
}

# Main
if [[ "$FORCE" == "false" ]] && is_cache_fresh; then
  cat "$CACHE_FILE" >&2
  emit_skill_env
  exit 0
fi

check_cli || exit_code=$?
exit_code=${exit_code:-0}
if (( exit_code == 2 )); then
  exit 2
fi
emit_skill_env
exit 1
