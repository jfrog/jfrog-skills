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
#   3 — jf is installed but below MIN_CLI_VERSION (required for `jf api`)
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

# Minimum jf CLI version required by this skill. `jf api` (the generic
# authenticated REST pass-through used by nearly every reference in this
# skill) landed in 2.100.0; older CLIs fail with "unknown command: api".
MIN_CLI_VERSION="2.100.0"

if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
fi

now_epoch() {
  date -u +%s
}

iso_now() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

# Returns 0 if $1 is strictly less than $2 (semver via sort -V).
version_lt() {
  [[ "$1" == "$2" ]] && return 1
  [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" == "$1" ]]
}

emit_min_version_error() {
  local v="$1"
  cat >&2 <<EOF
{"error": "jf CLI $v is below minimum $MIN_CLI_VERSION required by this skill (needed for 'jf api'). See references/jfrog-cli-install-upgrade.md."}
EOF
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

  local meets_minimum="true"
  if [[ "$cli_version" == "unknown" ]] || version_lt "$cli_version" "$MIN_CLI_VERSION"; then
    meets_minimum="false"
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
  "minimum_version": "$MIN_CLI_VERSION",
  "meets_minimum_version": $meets_minimum,
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
  local skill_version cli_version ua
  # Parse version from SKILL.md YAML frontmatter (metadata.version)
  skill_version="$(awk '/^---$/{n++; next} n==1 && /^[[:space:]]*version:/{gsub(/["'"'"']/, "", $2); print $2; exit}' "$SKILL_ROOT/SKILL.md" 2>/dev/null | tr -d '[:space:]')"
  skill_version="${skill_version:-unknown}"
  cli_version=$(jq -r '.cli_version // "unknown"' "$CACHE_FILE" 2>/dev/null || echo "unknown")
  ua=""
  if [[ -n "${JFROG_SKILL_MODEL:-}" ]]; then
    ua="model/${JFROG_SKILL_MODEL} "
  fi
  ua="${ua}jfrog-skills/${skill_version} jfrog-cli-go/${cli_version}"
  echo "export JFROG_CLI_USER_AGENT='${ua}'"
}

# Main
if [[ "$FORCE" == "false" ]] && is_cache_fresh; then
  cat "$CACHE_FILE" >&2
  # Re-evaluate the minimum on every run so a bumped MIN_CLI_VERSION
  # is enforced without waiting for the 24h cache to expire.
  cached_version=$(jq -r '.cli_version // "unknown"' "$CACHE_FILE" 2>/dev/null)
  if [[ "$cached_version" != "unknown" ]] && version_lt "$cached_version" "$MIN_CLI_VERSION"; then
    emit_min_version_error "$cached_version"
    exit 3
  fi
  emit_skill_env
  exit 0
fi

check_cli || exit_code=$?
exit_code=${exit_code:-0}
if (( exit_code == 2 )); then
  exit 2
fi

refreshed_version=$(jq -r '.cli_version // "unknown"' "$CACHE_FILE" 2>/dev/null)
if [[ "$refreshed_version" != "unknown" ]] && version_lt "$refreshed_version" "$MIN_CLI_VERSION"; then
  emit_min_version_error "$refreshed_version"
  exit 3
fi
emit_skill_env
exit 1
