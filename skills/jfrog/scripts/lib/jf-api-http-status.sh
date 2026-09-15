# shellcheck shell=bash
# Shared parser for `jf api` stderr. Sourced by login scripts and tests.
# Prints the last "Http Status: NNN" code, or 0 if none.
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
