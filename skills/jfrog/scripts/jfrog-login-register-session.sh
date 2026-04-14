#!/usr/bin/env bash
# jfrog-login-register-session.sh — Verify a JFrog server and start a web login session
#
# Pings the server, generates a session UUID, and registers it with
# the Access API for browser-based authentication.
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

JFROG_PLATFORM_URL="${1:-}"

if [[ -z "$JFROG_PLATFORM_URL" ]]; then
  echo "Usage: bash $0 <platform-url>" >&2
  exit 1
fi

JFROG_PLATFORM_URL="${JFROG_PLATFORM_URL%/}"

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl is not installed" >&2
  exit 1
fi

# Verify server is reachable
PING_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "${JFROG_PLATFORM_URL}/artifactory/api/system/ping")

if [[ "$PING_CODE" != "200" ]]; then
  echo "ERROR: Server not reachable at ${JFROG_PLATFORM_URL} (HTTP ${PING_CODE})" >&2
  exit 2
fi

# Generate session UUID
SESSION_UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
VERIFY_CODE=${SESSION_UUID: -4}

# Register the session with the Access API
REG_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "${JFROG_PLATFORM_URL}/access/api/v2/authentication/jfrog_client_login/request" \
  -H "Content-Type: application/json" \
  -d "{\"session\":\"${SESSION_UUID}\"}")

if [[ "$REG_CODE" != "200" && "$REG_CODE" != "201" ]]; then
  echo "ERROR: Session registration failed (HTTP ${REG_CODE})" >&2
  exit 3
fi

echo "SESSION_UUID=${SESSION_UUID}"
echo "VERIFY_CODE=${VERIFY_CODE}"
