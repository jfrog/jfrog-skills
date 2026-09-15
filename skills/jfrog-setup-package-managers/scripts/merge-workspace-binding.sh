#!/usr/bin/env bash
# merge-workspace-binding.sh — Persist a workspace binding after `jf setup`
#
# Merges one package-manager → Artifactory package-type → repo key into
# <workspace-root>/.jfrog/local/package-resolution.json.
# Keep the PM→type map in sync with references/workspace-binding.md.
#
# Usage:
#   bash merge-workspace-binding.sh \
#     --package-manager <pm> --repo <repoKey> [--workspace-root <dir>]
#
# Exit codes:
#   0 — Merged; stdout one-line confirmation
#   1 — Usage, missing jq, unknown PM, unsafe repo, I/O, or invalid existing JSON
#
# On invalid/corrupt existing JSON the file is left untouched (fail closed).
# The merge (validate → read → write → replace) is serialized per workspace
# via a mkdir-based directory lock (symlink-safe). mkdir is the mutex;
# owner-less dirs are never reclaimed (a crash between mkdir and the owner
# write fails closed at the retry cap). Dead-PID and foreign-hostname locks
# are reclaimed. Reclaim is serialized through a side-gate directory so a
# late reclaimer cannot delete a newly acquired lock.

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: bash merge-workspace-binding.sh --package-manager <pm> --repo <repoKey> [--workspace-root <dir>]

Merge repositories.<package-type>=<repoKey> into
<workspace-root>/.jfrog/local/package-resolution.json (default workspace-root: cwd).
USAGE
}

PACKAGE_MANAGER=""
REPO_KEY=""
WORKSPACE_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package-manager)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      PACKAGE_MANAGER="$2"
      shift 2
      ;;
    --repo)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      REPO_KEY="$2"
      shift 2
      ;;
    --workspace-root)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      WORKSPACE_ROOT="$2"
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

if [[ -z "$PACKAGE_MANAGER" || -z "$REPO_KEY" ]]; then
  usage
  exit 1
fi

if [[ -z "$WORKSPACE_ROOT" ]]; then
  WORKSPACE_ROOT="$(pwd)"
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is not installed" >&2
  exit 1
fi

# PM → Artifactory package type (see references/workspace-binding.md)
package_type_for_pm() {
  case "$1" in
    npm|pnpm|yarn) echo "npm" ;;
    pip|pipenv|uv|twine|poetry) echo "pypi" ;;
    maven) echo "maven" ;;
    gradle) echo "gradle" ;;
    go) echo "go" ;;
    docker|podman) echo "docker" ;;
    helm) echo "helm" ;;
    nuget|dotnet) echo "nuget" ;;
    *) return 1 ;;
  esac
}

PKG_TYPE="$(package_type_for_pm "$PACKAGE_MANAGER")" || {
  echo "ERROR: unknown package manager: $PACKAGE_MANAGER (no Artifactory package-type mapping)" >&2
  exit 1
}

# Same charset as APR hooks isSafeRepoKey
if [[ ! "$REPO_KEY" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "ERROR: unsafe repo key: $REPO_KEY (allowed: A-Za-z0-9._-)" >&2
  exit 1
fi

LOCAL_DIR="$WORKSPACE_ROOT/.jfrog/local"
TARGET="$LOCAL_DIR/package-resolution.json"
# Directory lock only — never open/truncate a lock *file* (symlink → data loss).
LOCK_DIR="$LOCAL_DIR/package-resolution.lock.d"
LOCK_OWNER="$LOCK_DIR/owner"
# Exclusive gate among reclaimers — prevents TOCTOU where a late reclaimer
# deletes a lock that another process acquired after the first reclaim.
RECLAIM_GATE="$LOCAL_DIR/package-resolution.lock.reclaiming"
TMP=""
LOCK_HELD=0

# Stale reclaim gate left after a crashed reclaimer (seconds).
RECLAIM_GATE_STALE_SECS=5

lock_hostname() {
  hostname 2>/dev/null || echo unknown
}

pid_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

# Seconds since path mtime.
# Try GNU/BusyBox `stat -c %Y` first, then BSD `stat -f %m`.
# Never lead with GNU `stat -f` (--file-system): it can emit multi-line
# stdout while failing, which poisons `a || b` command substitution on Linux.
path_age_secs() {
  local path="$1" mtime now
  if mtime="$(stat -c %Y "$path" 2>/dev/null)" && [[ "$mtime" =~ ^[0-9]+$ ]]; then
    :
  elif mtime="$(stat -f %m "$path" 2>/dev/null)" && [[ "$mtime" =~ ^[0-9]+$ ]]; then
    :
  else
    return 1
  fi
  now="$(date +%s)"
  echo $((now - mtime))
}

# True when LOCK_OWNER names a live holder on this host (do not reclaim).
# Foreign hostname: not live. kill -0 is meaningless across PID namespaces,
# and treating mismatch as live permanently blocks merges after host rename
# or a crashed remote holder. Multi-host NFS sharing of one workspace is
# unsupported — reclaim proceeds so local binding merges can recover.
owner_is_live() {
  local pid host me
  [[ -f "$LOCK_OWNER" && ! -L "$LOCK_OWNER" ]] || return 1
  pid="$(sed -n 's/^pid=//p' "$LOCK_OWNER" 2>/dev/null | head -1 | tr -d "[:space:]")"
  host="$(sed -n 's/^hostname=//p' "$LOCK_OWNER" 2>/dev/null | head -1 | tr -d "[:space:]")"
  me="$(lock_hostname)"
  if [[ -n "$host" && -n "$me" && "$host" != "$me" ]]; then
    return 1
  fi
  pid_alive "$pid"
}

# True when LOCK_DIR is a real directory that looks reclaimable right now.
# Owner-less dirs are never reclaimable: mkdir is the mutex, and a time-based
# grace cannot close the mkdir→owner-write window for a live holder.
lock_looks_stale() {
  if [[ -L "$LOCK_DIR" ]]; then
    return 1
  fi
  if [[ ! -d "$LOCK_DIR" ]]; then
    return 1
  fi
  if [[ -f "$LOCK_OWNER" && ! -L "$LOCK_OWNER" ]]; then
    if owner_is_live; then
      return 1
    fi
    return 0
  fi
  return 1
}

try_reclaim_stale_gate() {
  local age
  if [[ -L "$RECLAIM_GATE" ]]; then
    return 1
  fi
  if [[ ! -d "$RECLAIM_GATE" ]]; then
    return 1
  fi
  # Gate must be empty (reclaimer holds it only via mkdir).
  age="$(path_age_secs "$RECLAIM_GATE")" || return 1
  if ((age < RECLAIM_GATE_STALE_SECS)); then
    return 1
  fi
  rmdir "$RECLAIM_GATE" 2>/dev/null
}

# Reclaim LOCK_DIR only when it is a real directory (not a symlink) and the
# owner names a dead PID on this host or a foreign hostname. Owner-less dirs
# are not reclaimed (crash between mkdir and owner write fails closed).
# Serialization: only one reclaimer holds RECLAIM_GATE. Under the gate we
# re-check staleness, then rename LOCK_DIR aside and delete it. A contender
# that acquired a fresh lock after another reclaim cannot be deleted by a
# late reclaimer (they either fail the gate or fail the post-gate stale check).
try_reclaim_stale_lock() {
  local reclaim_path owner_snap

  if ! lock_looks_stale; then
    return 1
  fi

  if ! mkdir "$RECLAIM_GATE" 2>/dev/null; then
    try_reclaim_stale_gate || true
    return 1
  fi

  if ! lock_looks_stale; then
    rmdir "$RECLAIM_GATE" 2>/dev/null || true
    return 1
  fi

  # Snapshot owner (if any) so we only move the instance we inspected.
  owner_snap=""
  if [[ -f "$LOCK_OWNER" && ! -L "$LOCK_OWNER" ]]; then
    owner_snap="$(cat "$LOCK_OWNER" 2>/dev/null || true)"
    if owner_is_live; then
      rmdir "$RECLAIM_GATE" 2>/dev/null || true
      return 1
    fi
    if [[ "$(cat "$LOCK_OWNER" 2>/dev/null || true)" != "$owner_snap" ]]; then
      rmdir "$RECLAIM_GATE" 2>/dev/null || true
      return 1
    fi
  else
    # Missing or unexpected owner path — do not reclaim owner-less dirs.
    rmdir "$RECLAIM_GATE" 2>/dev/null || true
    return 1
  fi
  if [[ -z "$owner_snap" ]]; then
    rmdir "$RECLAIM_GATE" 2>/dev/null || true
    return 1
  fi

  reclaim_path="${LOCK_DIR}.reclaim.$$"
  if ! mv "$LOCK_DIR" "$reclaim_path" 2>/dev/null; then
    rmdir "$RECLAIM_GATE" 2>/dev/null || true
    return 1
  fi
  rm -rf "$reclaim_path"
  rmdir "$RECLAIM_GATE" 2>/dev/null || true
  return 0
}

release_lock() {
  if [[ "$LOCK_HELD" -ne 1 ]]; then
    return 0
  fi
  if [[ -L "$LOCK_DIR" ]]; then
    LOCK_HELD=0
    return 0
  fi
  if [[ -d "$LOCK_DIR" ]]; then
    rm -f "$LOCK_OWNER" 2>/dev/null || true
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
  LOCK_HELD=0
}

cleanup() {
  if [[ -n "${TMP:-}" && -e "$TMP" ]]; then
    rm -f "$TMP"
  fi
  release_lock
}
trap cleanup EXIT

mkdir -p "$LOCAL_DIR"

# Exclusive lock for the whole validate → read → merge → replace transaction.
# mkdir is atomic and does not follow a pre-planted symlink at LOCK_DIR
# (mkdir fails with EEXIST / ENOTDIR instead of truncating a target).
# mkdir is the mutex — owner is published after acquire for dead-PID /
# foreign-hostname reclaim only. Owner-less dirs are not reclaimed.
attempts=0
until mkdir "$LOCK_DIR" 2>/dev/null; do
  if try_reclaim_stale_lock; then
    continue
  fi
  attempts=$((attempts + 1))
  if ((attempts > 200)); then
    echo "ERROR: could not acquire workspace binding lock: $LOCK_DIR" >&2
    exit 1
  fi
  sleep 0.05
done
# Record owner so crash recovery can tell live holders from zombies.
printf "pid=%s\nhostname=%s\n" "$$" "$(lock_hostname)" >"$LOCK_OWNER"
LOCK_HELD=1

# Temp file: unpredictable name, restrictive mode (symlink-safe under LOCAL_DIR).
umask 077
TMP="$(mktemp "${LOCAL_DIR}/package-resolution.json.XXXXXX")"

# Re-validate and re-read TARGET under the lock (another merger may have just finished).
if [[ -e "$TARGET" ]]; then
  if ! jq -e 'type == "object"' "$TARGET" >/dev/null 2>&1; then
    echo "ERROR: invalid workspace binding JSON (not an object): $TARGET" >&2
    exit 1
  fi
  if ! jq -e '
    if has("repositories") then (.repositories | type == "object") else true end
  ' "$TARGET" >/dev/null 2>&1; then
    echo "ERROR: invalid workspace binding: repositories must be an object: $TARGET" >&2
    exit 1
  fi
  if ! jq -n \
    --slurpfile cur "$TARGET" \
    --arg type "$PKG_TYPE" \
    --arg repo "$REPO_KEY" \
    '
    ($cur[0].repositories // {}) as $repos
    | { repositories: ($repos + { ($type): $repo }) }
    ' >"$TMP"; then
    echo "ERROR: failed to merge workspace binding: $TARGET" >&2
    exit 1
  fi
else
  if ! jq -n \
    --arg type "$PKG_TYPE" \
    --arg repo "$REPO_KEY" \
    '{ repositories: { ($type): $repo } }' >"$TMP"; then
    echo "ERROR: failed to create workspace binding" >&2
    exit 1
  fi
fi

if ! mv "$TMP" "$TARGET"; then
  echo "ERROR: failed to write workspace binding: $TARGET" >&2
  exit 1
fi
TMP="" # moved; do not rm in cleanup

echo "merged $PKG_TYPE → $REPO_KEY into $TARGET"
