# Batch and Parallel Execution

Multiple independent operations → use lightest parallelism tier:

| Tier | Mechanism | Best for |
|------|-----------|----------|
| 1 | Single Shell call with `&&` | Few commands, same credentials |
| 2 | Parallel Shell tool calls | Independent commands, concurrency helps |
| 3 | Parallel subagents (Task tool) | Large multi-step jobs, each branch needs reasoning |

## Tier 1: Batch within a single Shell call

Combine independent commands with `&&`. All JFrog API calls share `jf api` +
`jf config` server — batching is safe and efficient:

```bash
jf api /artifactory/api/repositories > /tmp/jf-repos-$$.json && \
jf api /artifactory/api/system/ping    > /tmp/jf-ping-$$.json && \
jf api /artifactory/api/storageinfo    > /tmp/jf-storage-$$.json
```

Cross-product reads (Access, Xray, etc.) batch the same way — same `jf api`
command, just a different path per call.

## Tier 2: Parallel Shell tool calls

Multiple Shell tool calls in one message when commands are independent and
concurrency cuts runtime:

```bash
# Shell call 1 — echo the expanded path so the agent can reference it later
OUT=/tmp/jf-repos-$$.json
jf api /artifactory/api/repositories > "$OUT" && echo "$OUT"

# Shell call 2 (parallel) — same pattern, different PID
OUT=/tmp/jf-users-$$.json
jf api /access/api/v2/users/ > "$OUT" && echo "$OUT"
```

Each parallel Shell call gets different PID → `$$` differs. Echo path for
cross-call use (see SKILL.md **Preserving command output**).

## Tier 3: Parallel subagents

Multi-branch tasks (health reports, audits, user-named cross-server compare)
→ Task tool subagents. Each runs autonomously; parent merges results.

### Example — platform audit with three parallel subagents

```
Subagent 1 (shell): "Collect repository data"
  → jf api /artifactory/api/repositories
  → jf api /artifactory/api/storageinfo
  → Return repo count, types, total size

Subagent 2 (shell): "Collect security configuration"
  → jf api /xray/api/v2/policies
  → jf api /xray/api/v2/watches
  → Return policy count, watch count, coverage gaps

Subagent 3 (shell): "Collect user and permission data"
  → jf api /access/api/v2/users/
  → jf api /access/api/v2/groups/
  → jf api /access/api/v2/permissions/
  → Return user count, group count, admin users
```

All three run concurrently. Parent merges into unified report.

### How to structure a subagent prompt

1. State goal clearly (e.g. "Collect all Xray policies and watches").
2. Exact commands, or API tier + `--help` discovery.
3. Save to `/tmp/jf-<label>-$$.json`, echo expanded path, return structured summary.
4. Specify return fields (counts, lists) so parent need not re-read raw data.

### Subagent type selection

- `subagent_type="shell"` — known command sequences.
- `subagent_type="generalPurpose"` — needs skill references, `--help` discovery,
  or adaptive approach from intermediate results.

## When to use each tier

| Scenario | Tier |
|----------|------|
| 2–5 independent reads, same server | 1 (single Shell) |
| Many independent reads where concurrency cuts total runtime | 2 (parallel Shell) |
| Full platform audit, multi-section report, cross-server comparison | 3 (subagents) |
| Task branches need different reference files or reasoning | 3 (subagents) |
| Simple one-shot data fetch | 1 (single Shell) |

## When NOT to parallelize

- Later command depends on earlier output → sequential calls.
- **Mutating operations** — keep separate for user review.
- Different servers — only user-named (or default). Never fallback/iterate
  configured servers. See SKILL.md **Server selection rules**.
- Small task completing in seconds — subagent overhead not justified.

## Aggregating many outputs (JSONL, logs, ndjson)

Do **not** have multiple background processes append **unsynchronized** to the
same file — lines interleave, corrupt machine-readable output. Prefer sequential
writes, one file per worker/chunk then concatenate, or file locking.
See `references/general-bulk-operations-and-agent-patterns.md`.
