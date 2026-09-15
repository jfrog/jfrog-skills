# Bulk operations and agent execution patterns

Platform-wide guidance for agents gathering data from multiple JFrog products
(Artifactory, Xray, Access, Distribution, etc.), long shell sequences, or
parallel work. Product field names/endpoints in other `references/*` files;
this document = **patterns**, not one workflow.

## List vs detail responses

REST: **light list** + **detail GET**. Audit/join/permission fields often
detail-only — confirm via docs or sample GET before building on list alone.

## Volume, batching, and timeouts

- Estimate **N** round-trips before starting.
- Batch independent reads in one Shell when credentials/tier match (SKILL.md
  **Batch and parallel execution**).
- Large work → chunks, parallel Shell, or subagents per tiering.
- N+1 loop: wall time ≈ `N * 1.5s`; `block_until_ms` ≥ estimate + 30s.
- > ~60 items: Shell + progress log (`>> /tmp/jf-progress-$$.log`).
- Read-only independent items: Tier 2/3 (`general-parallel-execution.md`);
  rate limits; 4-8 parallel calls.

## Parallelism and shared files

**Unsafe:** Concurrent processes appending to **same** file (JSONL, logs, ndjson)
without sync → interleaved lines, broken parsers (JSON "Extra data" errors).

**Safer:**

- Write sequentially to one file; or
- One temp file per worker or chunk, then concatenate; or
- Advisory locking (`flock`) if one file must be shared.

Bulk API/CLI output: `/tmp` or `mktemp`; not `~/.jfrog/skills-cache/` except
`jfrog-skill-state.json` and OneModel schema (main SKILL.md).

## Shell hygiene

- `set -euo pipefail` in non-trivial scripts — failures not silent.
- Unique temp paths (`$$` in filename) + **echo expanded path** for cross-call
  reuse (SKILL.md **Preserving command output** — `$$` + echo, session ID, hardcoded patterns).
- Parse CLI/API JSON with **`jq`**.

## Safe multi-response collection

Looping items (repos, builds, users) + per-item detail:

1. Save each response to variable or per-item file.
2. Validate with `jq -e . >/dev/null 2>&1` before appending.
3. On validation failure, structured error line → partial results without crash.
4. After loop, `jq -s '.' results.ndjson` → single array.

```bash
: >results.ndjson
while read -r key; do
  body=$(jf api "/artifactory/api/repositories/$key" || true)
  if echo "$body" | jq -e . >/dev/null 2>&1; then
    echo "$body" | jq -c . >>results.ndjson
  else
    printf '{"key":"%s","_error":"invalid_response"}\n' "$key" >>results.ndjson
  fi
done < <(jq -r '.[].key' list.json)
jq -s '.' results.ndjson > details.json
```

Never pipe loop of `jf api` calls directly into `jq -s` without per-body validation.

## Where to find product specifics

- Artifactory REST nuances: `references/artifactory-api-gaps.md`
- Platform admin / Access: `references/platform-admin-api-gaps.md`
- JFrog Projects (endpoints): `references/projects-api.md`
- Joining Artifactory repos to Projects (`projectKey`, roles, environments):
  `references/platform-access-entities.md`
- Platform API invocation (all products through `jf api`): see
  `SKILL.md` § *Invoking platform APIs with `jf api`*
