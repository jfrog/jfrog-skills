#!/usr/bin/env bash
# cli-newer-version-offer.sh — Read the pending CLI upgrade flag.
#
# check-environment.sh is the only writer of suggest_upgrade (true when
# latest is first evaluated or replaced and is strictly newer than
# cli_version). This script only reads that bool and, after Yes or No,
# --clear writes false. It does not run jf.
#
# Usage:
#   bash cli-newer-version-offer.sh
#   bash cli-newer-version-offer.sh --clear
#
# stdout (exactly one line, always exit 0):
#   SKIP
#   NEWER_AVAILABLE <cli_version> <latest_version_available>

set -euo pipefail

JFROG_HOME="${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}"
CACHE_DIR="$JFROG_HOME/skills-cache"
CACHE_FILE="$CACHE_DIR/jfrog-skill-state.json"

emit_skip() {
  printf '%s\n' "SKIP"
  exit 0
}

write_cache() {
  command -v jq >/dev/null 2>&1 || return 0
  mkdir -p "$CACHE_DIR" || return 0
  local state="$1"
  local tmp="${CACHE_DIR}/.jfrog-skill-state.$$.tmp"
  printf '%s\n' "$state" >"$tmp" || return 0
  mv "$tmp" "$CACHE_FILE" || return 0
}

if [[ "${1:-}" == "--clear" ]]; then
  if [[ -f "$CACHE_FILE" ]] && command -v jq >/dev/null 2>&1; then
    local_state="$(jq -c '.suggest_upgrade = false' \
      "$CACHE_FILE" 2>/dev/null)" && write_cache "$local_state"
  fi
  emit_skip
fi

if command -v jq >/dev/null 2>&1 && [[ -f "$CACHE_FILE" ]] \
  && jq -e '.suggest_upgrade == true' "$CACHE_FILE" >/dev/null 2>&1; then
  current="$(jq -r '.cli_version // empty' "$CACHE_FILE" 2>/dev/null)" || emit_skip
  latest="$(jq -r '.latest_version_available // empty' "$CACHE_FILE" 2>/dev/null)" || emit_skip
  printf '%s\n' "NEWER_AVAILABLE ${current} ${latest}"
  exit 0
fi
emit_skip
