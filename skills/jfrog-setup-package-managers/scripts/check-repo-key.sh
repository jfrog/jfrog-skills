#!/usr/bin/env bash
# check-repo-key.sh — Accept a value only if it matches APR isSafeRepoKey.
#
# Usage:
#   bash check-repo-key.sh --repo <repoKey>
#   bash check-repo-key.sh --server-id <serverId>
#   bash check-repo-key.sh --project <projectKey>
#
# One flag per call. The same allowlist covers every value placed on the
# jf setup command line.
#
# Exit 0: trimmed value on stdout.
# Exit 1: usage or unsafe value on stderr. Nothing on stdout.
# Does not run jf. jf setup checks that the repo exists; this only blocks
# a value that must not be placed on a shell command line.

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: bash check-repo-key.sh --repo <repoKey>
       bash check-repo-key.sh --server-id <serverId>
       bash check-repo-key.sh --project <projectKey>

Print the trimmed value on stdout when it matches ^[A-Za-z0-9._-]+$
(APR isSafeRepoKey). Exit 1 otherwise. One flag per call. Does not run jf.
USAGE
}

REPO_KEY=""
LABEL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo|--server-id|--project)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      [[ -z "$LABEL" ]] || { echo "ERROR: one flag per call" >&2; usage; exit 1; }
      case "$1" in
        --repo) LABEL="repo key" ;;
        --server-id) LABEL="server id" ;;
        --project) LABEL="project key" ;;
      esac
      REPO_KEY="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$LABEL" ]]; then
  usage
  exit 1
fi

trim() {
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}

REPO_KEY="$(trim "$REPO_KEY")"

# Same charset as APR hooks isSafeRepoKey (repo-types.mjs).
if [[ ! "$REPO_KEY" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "ERROR: unsafe ${LABEL}: ${REPO_KEY} (allowed: A-Za-z0-9._-)" >&2
  exit 1
fi

printf '%s\n' "$REPO_KEY"
