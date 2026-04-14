#!/usr/bin/env bash
# get-platform-credentials.sh — Extract JFrog Platform credentials
#
# Extracts URL and access token from jf config export for use with
# plain curl calls to JFrog Platform APIs.
#
# Usage:
#   eval "$(bash get-platform-credentials.sh [server-id])"
#
# After eval, these variables are available:
#   JFROG_URL            — Platform base URL (no trailing slash)
#   JFROG_ACCESS_TOKEN   — Access token for Bearer auth
#   JFROG_RT_URL         — Artifactory URL
#   JFROG_XR_URL         — Xray URL
#   JFROG_DS_URL         — Distribution URL
#   JFROG_MC_URL         — Mission Control URL
#   JFROG_SERVER_ID      — Server ID used

set -euo pipefail

SERVER_ID="${1:-}"

if ! command -v jf &>/dev/null; then
  echo "echo 'ERROR: jf CLI is not installed'" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "echo 'ERROR: jq is not installed'" >&2
  exit 1
fi

# Export config as base64-encoded JSON
if [[ -n "$SERVER_ID" ]]; then
  CONFIG_JSON=$(jf config export "$SERVER_ID" 2>/dev/null | base64 -d)
else
  CONFIG_JSON=$(jf config export 2>/dev/null | base64 -d)
fi

if [[ -z "$CONFIG_JSON" ]]; then
  echo "echo 'ERROR: Failed to export jf config'" >&2
  exit 1
fi

# Extract fields
JFROG_URL=$(echo "$CONFIG_JSON" | jq -r '.url // empty')
JFROG_URL="${JFROG_URL%/}"
JFROG_ACCESS_TOKEN=$(echo "$CONFIG_JSON" | jq -r '.accessToken // empty')
JFROG_RT_URL=$(echo "$CONFIG_JSON" | jq -r '.artifactoryUrl // empty')
JFROG_RT_URL="${JFROG_RT_URL%/}"
JFROG_XR_URL=$(echo "$CONFIG_JSON" | jq -r '.xrayUrl // empty')
JFROG_XR_URL="${JFROG_XR_URL%/}"
JFROG_DS_URL=$(echo "$CONFIG_JSON" | jq -r '.distributionUrl // empty')
JFROG_DS_URL="${JFROG_DS_URL%/}"
JFROG_MC_URL=$(echo "$CONFIG_JSON" | jq -r '.missionControlUrl // empty')
JFROG_MC_URL="${JFROG_MC_URL%/}"
JFROG_SERVER_ID=$(echo "$CONFIG_JSON" | jq -r '.serverId // empty')

if [[ -z "$JFROG_URL" ]]; then
  echo "echo 'ERROR: No URL found in jf config export'" >&2
  exit 1
fi

if [[ -z "$JFROG_ACCESS_TOKEN" ]]; then
  echo "echo 'WARNING: No access token found in jf config export'" >&2
fi

# Output as shell variable assignments for eval
cat <<EOF
export JFROG_URL='${JFROG_URL}'
export JFROG_ACCESS_TOKEN='${JFROG_ACCESS_TOKEN}'
export JFROG_RT_URL='${JFROG_RT_URL}'
export JFROG_XR_URL='${JFROG_XR_URL}'
export JFROG_DS_URL='${JFROG_DS_URL}'
export JFROG_MC_URL='${JFROG_MC_URL}'
export JFROG_SERVER_ID='${JFROG_SERVER_ID}'
EOF
