# Bulk operations and agent execution patterns

Platform-wide guidance for agents that gather data from multiple JFrog products
(Artifactory, Xray, Access, Distribution, etc.), run long shell
sequences, or parallelize work. Product-specific field names and endpoints live
in the other `references/*` files; this document describes **patterns**, not
one workflow.

## List vs detail responses

Many REST surfaces expose a **light list** (keys, names, minimal fields) and a
**richer GET by id or key**. Fields needed for audits, reporting, joins, or
permission checks may appear **only** on the detail response. Before building a
multi-step flow on a single list call, confirm in API docs or with a sample GET
whether the fields you need are present.

## Volume, batching, and timeouts

- Estimate **N** round-trips (list + per-item GETs, paginated APIs, etc.) before
  starting so execution time and tool timeouts stay predictable.
- Prefer batching independent reads in one Shell invocation when credentials and
  tier match (see SKILL.md **Batch and parallel execution**).
- Split very large work across chunks, parallel Shell calls, or subagents when
  the skill's tiering guidance says so.
- Before starting an N+1 loop (list + per-item detail), **estimate wall time**
  as roughly `N * 1.5s` for sequential calls. Set `block_until_ms` to at
  least that estimate plus a 30-second buffer.
- For loops exceeding ~60 items, prefer a single Shell invocation that writes
  progress to a log file (`>> /tmp/jf-progress-$$.log`) so partial results
  are visible even if the job is interrupted.
- If the task is read-only and items are independent, consider Tier 2 or
  Tier 3 parallelism (see `general-parallel-execution.md`) to reduce total time —
  but respect rate limits and keep concurrency modest (4-8 parallel calls).

## Parallelism and shared files

**Unsafe:** Multiple concurrent processes appending lines to the **same** file
(JSONL, logs, ndjson) without synchronization. Output can interleave on one
line and break parsers (e.g. JSON "Extra data" errors).

**Safer:**

- Write sequentially to one file; or
- One temp file per worker or chunk, then concatenate; or
- Use advisory locking (`flock`) if one file must be shared.

## Agent sandboxes and the environment check

`scripts/check-environment.sh` does **not** call your JFrog server, but it may
make an outbound request to `releases.jfrog.io` for version checking and may
**write**
`<skill_path>/local-cache/jfrog-skill-state.json` when the cache is stale or missing. In a
restricted agent sandbox, **workspace write** access can fail even when
`full_network` is granted. Request permissions that allow writing `<skill_path>/local-cache`
when the check fails with a filesystem error.

For bulk API or CLI output files, use `/tmp` or `mktemp`; do not use
`local-cache/` except for `jfrog-skill-state.json` and the OneModel schema file
(see main SKILL.md).

## Shell hygiene

- Use `set -euo pipefail` in non-trivial scripts so failures are not silent.
- Use unique temp paths (e.g. `$$` in the filename) and **echo the expanded
  path** so it can be reused across Shell calls (see SKILL.md **Preserving
  command output** for the `$$` + echo, session ID, and hardcoded patterns).
- Parse CLI and API JSON with **`jq`**.

## Safe multi-response collection

When looping over items (repos, builds, users) and fetching detail for each:

1. Save each response to a variable or per-item file.
2. Validate with `jq -e . >/dev/null 2>&1` before appending.
3. On validation failure, write a structured error line so the caller can
   report partial results instead of crashing.
4. After the loop, `jq -s '.' results.ndjson` to produce a single array.

```bash
: >results.ndjson
while read -r key; do
  body=$(jf rt curl -sS -XGET "/api/repositories/$key" || true)
  if echo "$body" | jq -e . >/dev/null 2>&1; then
    echo "$body" | jq -c . >>results.ndjson
  else
    printf '{"key":"%s","_error":"invalid_response"}\n' "$key" >>results.ndjson
  fi
done < <(jq -r '.[].key' list.json)
jq -s '.' results.ndjson > details.json
```

Never pipe a loop of `jf rt curl` calls directly into `jq -s` without
per-body validation.

## Where to find product specifics

- Artifactory REST nuances: `references/artifactory-api-gaps.md`
- Platform admin / Access: `references/platform-admin-api-gaps.md`
- JFrog Projects (endpoints): `references/projects-api.md`
- Joining Artifactory repos to Projects (`projectKey`, roles, environments):
  `references/platform-access-entities.md`
- Credential tiers: `references/jfrog-credential-patterns.md`
