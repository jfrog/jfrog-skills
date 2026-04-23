#!/usr/bin/env bash
# jfrog-login-save-credentials.sh — Complete web login by retrieving token and saving credentials
#
# Retrieves the one-time access token from a completed web login session,
# derives a server ID, saves the configuration via jf config, and verifies.
# Bootstrap token exchange uses `jf api --url` (before any server exists in
# `jf config`); verification uses `jf api` with --server-id.
#
# IMPORTANT: The token endpoint is one-time-use. If this script fails after
# consuming the token (e.g. jf config write blocked by sandbox), the session
# is burned and login must restart from register-session.
#
# Usage:
#   bash jfrog-login-save-credentials.sh <platform-url> <session-uuid>
#
# Arguments:
#   platform-url  — Full JFrog Platform URL (e.g. https://mycompany.jfrog.io)
#   session-uuid  — Session UUID from jfrog-login-register-session.sh output
#
# Output (stdout):
#   SERVER_ID=<derived-server-id>
#   Followed by the Artifactory version JSON on success.
#
# Exit codes:
#   0 — Login succeeded, credentials saved and verified
#   1 — Missing arguments or prerequisites
#   2 — Token retrieval failed (user may not have completed browser login)
#   3 — Empty token in response
#   4 — jf config save or verification failed

set -euo pipefail

jf_api_http_status() {
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
SESSION_UUID="${2:-}"

if [[ -z "$JFROG_PLATFORM_URL" || -z "$SESSION_UUID" ]]; then
  echo "Usage: bash $0 <platform-url> <session-uuid>" >&2
  exit 1
fi

JFROG_PLATFORM_URL="${JFROG_PLATFORM_URL%/}"

for cmd in jq jf; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: ${cmd} is not installed" >&2
    exit 1
  fi
done

# Derive server ID from URL
# SaaS:        https://mycompany.jfrog.io  → mycompany
# Self-hosted:  https://artifactory.internal.corp → artifactory-internal-corp
JFROG_HOST=$(echo "$JFROG_PLATFORM_URL" | \
  sed 's|^[a-z]*://||' | sed 's|\.jfrog\.io.*||' | sed 's|[./]|-|g')

# Retrieve the one-time token (stdout = JSON body; stderr = jf status lines)
RESP_FILE="/tmp/jf-login-resp-$$.json"
STDERR_FILE="/tmp/jf-login-err-$$.txt"
trap 'rm -f "$RESP_FILE" "$STDERR_FILE"' EXIT

: >"$STDERR_FILE"
set +e
jf api "/access/api/v2/authentication/jfrog_client_login/token/${SESSION_UUID}" \
  --url "$JFROG_PLATFORM_URL" \
  >"$RESP_FILE" 2>"$STDERR_FILE"
api_exit=$?
set -e

HTTP_CODE=$(jf_api_http_status "$STDERR_FILE")
if [[ "$HTTP_CODE" == "0" ]]; then
  HTTP_CODE=$(jf_api_http_status "$RESP_FILE")
fi

if (( api_exit != 0 )); then
  echo "ERROR: Token retrieval failed (HTTP ${HTTP_CODE}, exit ${api_exit})." >&2
  if [[ "$HTTP_CODE" == "400" ]]; then
    echo "The user may not have completed the browser login yet." >&2
  fi
  exit 2
fi

ACCESS_TOKEN=$(grep -v '\[Info\]' "$RESP_FILE" | jq -r '.access_token // empty')

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "ERROR: Response contained no access token. Login must restart from step 1." >&2
  exit 3
fi

# Save credentials to jf config (writes to ~/.jfrog/, needs unrestricted filesystem)
jf config remove "$JFROG_HOST" --quiet 2>/dev/null || true

if ! jf config add "$JFROG_HOST" \
  --url="$JFROG_PLATFORM_URL" \
  --access-token="$ACCESS_TOKEN" \
  --interactive=false 2>/dev/null; then
  echo "ERROR: Failed to save credentials with jf config add." >&2
  echo "This may be caused by sandbox restrictions on ~/.jfrog/ writes." >&2
  exit 4
fi

jf config use "$JFROG_HOST"

echo "SERVER_ID=${JFROG_HOST}"

echo "--- Verifying authentication ---"
if ! jf api "/artifactory/api/system/version" --server-id="$JFROG_HOST"; then
  echo "ERROR: Authentication verification failed. Token may not have saved correctly." >&2
  exit 4
fi
