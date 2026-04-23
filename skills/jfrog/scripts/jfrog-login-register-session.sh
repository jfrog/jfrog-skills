#!/usr/bin/env bash
# jfrog-login-register-session.sh — Verify a JFrog server and start a web login session
#
# Pings the server, generates a session UUID, and registers it with
# the Access API for browser-based authentication (bootstrap HTTP via
# `jf api --url`).
#
# Usage:
#   bash jfrog-login-register-session.sh <platform-url>
#
# Arguments:
#   platform-url  — Full JFrog Platform URL (e.g. https://mycompany.jfrog.io)
#
# Output (stdout, one key=value per line):
#   SESSION_UUID=<uuid>
#   VERIFY_CODE=<last 4 chars of uuid>
#
# Exit codes:
#   0 — Session registered successfully
#   1 — Missing arguments or prerequisites
#   2 — Server not reachable (ping failed)
#   3 — Session registration request failed

set -euo pipefail

jf_api_http_status() {
  # Parses "Http Status: NNN" from jf api stderr.
  local err_file="$1"
  local line
  line=$(grep -F 'Http Status:' "$err_file" 2>/dev/null | tail -1 || true)
  if [[ "$line" =~ Http\ Status:\ ([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo "0"
  fi
}

JFROG_PLATFORM_URL="${1:-}"

if [[ -z "$JFROG_PLATFORM_URL" ]]; then
  echo "Usage: bash $0 <platform-url>" >&2
  exit 1
fi

JFROG_PLATFORM_URL="${JFROG_PLATFORM_URL%/}"

if ! command -v jf &>/dev/null; then
  echo "ERROR: jf is not installed" >&2
  exit 1
fi

if ! command -v uuidgen &>/dev/null; then
  echo "ERROR: uuidgen is not installed" >&2
  exit 1
fi

TMPERR="$(mktemp)"
trap 'rm -f "$TMPERR"' EXIT

# Verify server is reachable (unauthenticated ping)
if ! jf api /artifactory/api/system/ping --url "$JFROG_PLATFORM_URL" >/dev/null 2>"$TMPERR"; then
  PING_CODE=$(jf_api_http_status "$TMPERR")
  echo "ERROR: Server not reachable at ${JFROG_PLATFORM_URL} (HTTP ${PING_CODE})" >&2
  exit 2
fi

# Generate session UUID
SESSION_UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
VERIFY_CODE=${SESSION_UUID: -4}

# Register the session with the Access API
: >"$TMPERR"
if ! jf api /access/api/v2/authentication/jfrog_client_login/request \
  --url "$JFROG_PLATFORM_URL" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"session\":\"${SESSION_UUID}\"}" >/dev/null 2>"$TMPERR"; then
  REG_CODE=$(jf_api_http_status "$TMPERR")
  echo "ERROR: Session registration failed (HTTP ${REG_CODE})" >&2
  exit 3
fi

echo "SESSION_UUID=${SESSION_UUID}"
echo "VERIFY_CODE=${VERIFY_CODE}"
