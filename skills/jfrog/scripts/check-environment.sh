#!/usr/bin/env bash
# check-environment.sh — Cached JFrog CLI environment check
#
# Checks if jf is installed and its version, using a 24h-TTL cache
# at ${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}/skills-cache/jfrog-skill-state.json
# to avoid redundant checks. The skills-cache/ dir holds only this file and
# the OneModel schema cache — not temp API output.
#
# Usage:
#   bash check-environment.sh [<model-slug>] [--force]
#
# stdout: bare JFROG_CLI_USER_AGENT value (one line) — agent captures it
#         and runs `export JFROG_CLI_USER_AGENT='<v>'` once at the top of
#         every bash invocation that calls jf
# stderr: JSON state (informational, also written to cache file)
#
# Exit codes:
#   0 — cache fresh, CLI ready
#   1 — cache refreshed, CLI ready
#   2 — jf not installed
#   3 — jf below MIN_CLI_VERSION (required for `jf api`)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
JFROG_HOME="${JFROG_CLI_HOME_DIR:-$HOME/.jfrog}"
CACHE_DIR="$JFROG_HOME/skills-cache"
CACHE_FILE="$CACHE_DIR/jfrog-skill-state.json"
DEFAULT_TTL_HOURS=24
FORCE=false

# Minimum jf CLI version required by this skill. `jf api` (the generic
# authenticated REST pass-through used by nearly every reference in this
# skill) landed in 2.100.0; older CLIs fail with "unknown command: api".
MIN_CLI_VERSION="2.100.0"

# CLIs >= this version emit ai-agent/ + ai-client/ + ai-model/ (Client→Agent→Model
# via jfrog-cli-core #1602 + jfrog-cli #3645). Omit client= in the skill UA to
# avoid double-encoding. Always emit tool= — mcp-management Step A parses it from
# this script's stdout, which never includes the CLI's ai-agent/ token.
#
# MERGE / RELEASE PIN: tip `CliVersion` is still 2.119.0 while the identity code
# is already on master. Released 2.118/2.119 only appended ai-agent/. Keep this
# gate at the first *released* CLI that ships full Client→Agent→Model (expected
# 2.120.0). When that release cuts, confirm the tag and update this constant if
# the version number differs — do not lower it to tip's 2.119.0.
AGENT_UA_MIN_CLI_VERSION="2.120.0"

MODEL_SLUG=""
for arg in "$@"; do
  if [[ "$arg" == "--force" ]]; then
    FORCE=true
  elif [[ -z "$MODEL_SLUG" ]]; then
    MODEL_SLUG="$arg"
  fi
done

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

# Lowercase and keep only [a-z0-9._-], then truncate to 64 chars — mirrors the
# Go CLI sanitizeToken (cardinality bound + no header-splitting on the wire).
sanitize_token() {
  local s
  s="$(printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9._-')"
  printf '%s' "${s:0:64}"
}

# Map a generic AI_AGENT/AGENT value (agents.md proposal, @vercel/detect-agent)
# to a canonical name. Strips a version suffix (e.g. "goose@1.2.3") and lowercases.
# Empty input → nothing; unrecognized non-empty → "unknown".
# Accepts both hyphenated ecosystem ids and our underscore/canonical forms so
# AI_AGENT=roo_code / amazon_q / qwen round-trip the same as the Go CLI.
canonical_agent_name() {
  local raw
  raw="$(printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  raw="${raw%%@*}"
  raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    "") ;;
    claude-code|claude) echo "claude" ;;
    gemini-cli|gemini) echo "gemini" ;;
    goose) echo "goose" ;;
    cursor-cli|cursor) echo "cursor" ;;
    github-copilot|copilot-cli|copilot) echo "copilot" ;;
    kilocode) echo "kilocode" ;;
    roo-code|roo_code) echo "roo_code" ;;
    codex) echo "codex" ;;
    windsurf) echo "windsurf" ;;
    aider) echo "aider" ;;
    cline) echo "cline" ;;
    opencode) echo "opencode" ;;
    amp) echo "amp" ;;
    augment) echo "augment" ;;
    qwen-code|qwen) echo "qwen" ;;
    antigravity) echo "antigravity" ;;
    crush) echo "crush" ;;
    iflow) echo "iflow" ;;
    trae) echo "trae" ;;
    amazon-q-cli|amazon-q|amazon_q) echo "amazon_q" ;;
    *) echo "unknown" ;;
  esac
}

# Detect the calling harness from environment signals. First-match order matches
# the JFrog CLI's DetectExecutionContext() table (claude, gemini, goose, cursor,
# …) plus v0.22.0 product envs so mcp-management Step A still sees tool=claude /
# tool=cursor in Claude Code / Cursor IDE terminals (CLAUDECODE, CURSOR_TRACE_ID).
# Those product envs are also set for humans; real agent skill usage is the
# model= slug. Devin Desktop is not detected here — see harness-common.md.
# MODEL_SLUG→unknown fallback is applied by emit_skill_env (not here).
detect_harness() {
  # Claude/Cursor: session markers OR the v0.22.0 product envs Agent Guard uses.
  # Other rows stay on CLI session markers.
  if [[ -n "${CLAUDE_CODE_CHILD_SESSION:-}" || -n "${CLAUDECODE:-}" || -n "${CLAUDE_CODE_ENTRYPOINT:-}" ]]; then
    echo "claude"
  elif [[ -n "${GEMINI_CLI:-}" ]]; then
    echo "gemini"
  elif [[ -n "${GOOSE_TERMINAL:-}" ]]; then
    echo "goose"
  elif [[ -n "${CURSOR_AGENT:-}" || "${CURSOR_EXTENSION_HOST_ROLE:-}" == "agent-exec" || -n "${CURSOR_CLI:-}" || -n "${CURSOR_TRACE_ID:-}" ]]; then
    echo "cursor"
  elif [[ -n "${COPILOT_CLI:-}" || -n "${COPILOT_AGENT_SESSION_ID:-}" ]]; then
    echo "copilot"
  elif [[ -n "${KILOCODE_FEATURE:-}" || -n "${KILO_PID:-}" ]]; then
    echo "kilocode"
  elif [[ -n "${ROO_ACTIVE:-}" || -n "${ROO_CLI_RUNTIME:-}" ]]; then
    echo "roo_code"
  elif [[ -n "${CODEX_CI:-}" || -n "${CODEX_THREAD_ID:-}" || -n "${CODEX_SANDBOX:-}" ]]; then
    echo "codex"
  elif [[ -n "${WINDSURF_CASCADE_TERMINAL:-}" ]]; then
    echo "windsurf"
  elif [[ -n "${CLINE_ACTIVE:-}" ]]; then
    echo "cline"
  elif [[ -n "${OPENCODE:-}" || -n "${OPENCODE_SESSION_ID:-}" ]]; then
    echo "opencode"
  elif [[ -n "${AMP_CURRENT_THREAD_ID:-}" ]]; then
    echo "amp"
  elif [[ -n "${AUGMENT_AGENT:-}" ]]; then
    echo "augment"
  elif [[ -n "${QWEN_CODE:-}" ]]; then
    echo "qwen"
  elif [[ -n "${ANTIGRAVITY_AGENT:-}" ]]; then
    echo "antigravity"
  elif [[ -n "${CRUSH:-}" ]]; then
    echo "crush"
  elif [[ -n "${IFLOW_CLI:-}" ]]; then
    echo "iflow"
  elif [[ -n "${TRAE_AI_SHELL_ID:-}" ]]; then
    echo "trae"
  elif [[ -n "${AI_AGENT:-}" || -n "${AGENT:-}" ]]; then
    # aider and amazon_q have no reliable session env — AI_AGENT / AGENT only.
    canonical_agent_name "${AI_AGENT:-${AGENT:-}}"
  fi
  # No match → print nothing; emitter may still apply MODEL_SLUG→unknown.
}

# Emit skill-level env vars to stdout (for eval by the caller)
emit_skill_env() {
  local skill_version cli_version ua harness harness_from_model_fallback=false
  # Parse version from SKILL.md YAML frontmatter (metadata.version)
  skill_version="$(awk '/^---$/{n++; next} n==1 && /^[[:space:]]*version:/{gsub(/["'"'"']/, "", $2); print $2; exit}' "$SKILL_ROOT/SKILL.md" 2>/dev/null | tr -d '[:space:]')"
  skill_version="${skill_version:-unknown}"
  # Prefer a live `jf --version` so AGENT_UA_MIN omit-gate is not stuck on a
  # stale cache for up to 24h after the user upgrades the CLI.
  cli_version="$(jf --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  cli_version="${cli_version:-$(jq -r '.cli_version // "unknown"' "$CACHE_FILE" 2>/dev/null || echo "unknown")}"
  # Sanitize the model slug once so the MODEL_SLUG→unknown fallback and the
  # wire model= key share the same cardinality-bounded, header-safe value
  # (mirrors the CLI's sanitizeToken on JFROG_CLI_AI_MODEL).
  MODEL_SLUG="$(sanitize_token "${MODEL_SLUG:-}")"
  harness=$(detect_harness)
  # Defense: re-canonicalize so alias wire values (e.g. claude-code from a
  # hand-built AI_AGENT / future detector slip) never reach tool=. Empty stays
  # empty; known aliases map; unrecognized non-empty → unknown.
  if [[ -n "$harness" ]]; then
    h2=$(canonical_agent_name "$harness")
    [[ -n "$h2" ]] && harness=$h2
  fi
  # Agent invoked us (passed a model slug) but set no harness signal the CLI
  # shares — CLI will not emit ai-agent/, so the skill must still carry tool=.
  if [[ -z "$harness" && -n "$MODEL_SLUG" ]]; then
    harness="unknown"
    harness_from_model_fallback=true
  fi
  # Client (TERM_PROGRAM): app hosting the session. Omitted on new CLI when the
  # CLI will emit ai-client/ itself (not on the model-slug fallback path).
  local client
  client="$(sanitize_token "${TERM_PROGRAM:-}")"
  local carry_client_ua="false"
  if [[ "$cli_version" == "unknown" ]] || version_lt "$cli_version" "$AGENT_UA_MIN_CLI_VERSION" || [[ "$harness_from_model_fallback" == "true" ]]; then
    carry_client_ua="true"
  fi
  # Build the parens block: semicolon-separated key=value pairs.
  # trigger=skill always leads — this script only runs on the skill path.
  # (APR agent-hooks set trigger=hook when they spawn jf; see eager-setup.)
  # tool= is always emitted when known: mcp-management parses this stdout line
  # and never sees the CLI's later ai-agent/ token.
  local meta="trigger=skill"
  if [[ -n "$harness" ]]; then
    meta="${meta}; tool=${harness}"
  fi
  if [[ "$carry_client_ua" == "true" && -n "$harness" && -n "$client" ]]; then
    meta="${meta}; client=${client}"
  fi
  # model= is emitted regardless of CLI version (not deduped like tool=/client=):
  # the CLI's own ai-model/ token is conditional on it detecting the agent via
  # env AND the caller exporting JFROG_CLI_AI_MODEL, so the skill can't know
  # whether the CLI will carry it. Keeping model= here guarantees the slug is
  # always recorded; Coralogix coalesces the two sources so it isn't counted twice.
  if [[ -n "$MODEL_SLUG" ]]; then
    meta="${meta}; model=${MODEL_SLUG}"
  fi
  ua="jfrog-skills/${skill_version} (${meta}) jfrog-cli-go/${cli_version}"
  printf '%s\n' "$ua"
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
