# Batch and Parallel Execution

When a task requires multiple independent operations, use the lightest
parallelism mechanism that fits. Three tiers are available, from lightest to
heaviest:

| Tier | Mechanism | Best for |
|------|-----------|----------|
| 1 | Single Shell call with `&&` | Few commands, same credentials |
| 2 | Parallel Shell tool calls | Independent commands that can run concurrently |
| 3 | Parallel subagents (Task tool) | Large multi-step jobs where each branch needs its own reasoning |

## Tier 1: Batch within a single Shell call

Combine independent commands with `&&`. All JFrog API calls go through the
same `jf api` command and the same `jf config` server, so batching them
together is both safe and efficient:

```bash
jf api /artifactory/api/repositories > /tmp/jf-repos-$$.json && \
jf api /artifactory/api/system/ping    > /tmp/jf-ping-$$.json && \
jf api /artifactory/api/storageinfo    > /tmp/jf-storage-$$.json
```

Cross-product reads batch the same way:

```bash
jf api /access/api/v2/users/        > /tmp/jf-users-$$.json && \
jf api /access/api/v2/groups/       > /tmp/jf-groups-$$.json && \
jf api /access/api/v2/permissions/  > /tmp/jf-perms-$$.json
```

## Tier 2: Parallel Shell tool calls

Use multiple Shell tool calls in the same message when the commands are
independent and the total runtime benefits from concurrency:

```bash
# Shell call 1 — echo the expanded path so the agent can reference it later
OUT=/tmp/jf-repos-$$.json
jf api /artifactory/api/repositories > "$OUT" && echo "$OUT"

# Shell call 2 (parallel) — same pattern, different PID
OUT=/tmp/jf-users-$$.json
jf api /access/api/v2/users/ > "$OUT" && echo "$OUT"
```

Each parallel Shell call gets a different PID, so `$$` expands to different
values. Echo the path so the agent knows the literal filename for cross-call
use (see SKILL.md **Preserving command output**).

## Tier 3: Parallel subagents

For tasks with multiple independent branches that each require several steps
or their own reasoning — such as generating a platform health report with
separate sections, auditing both repository config and security policies, or
comparing configurations across servers the user explicitly named — launch
parallel subagents using the Task tool.

Each subagent runs autonomously, executes its own CLI/API calls, and returns
a structured result. The parent agent assembles the final answer.

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

All three subagents run concurrently. Once all complete, the parent agent
merges their results into a unified report.

### How to structure a subagent prompt

1. State the goal clearly (e.g. "Collect all Xray policies and watches").
2. Provide the exact commands to run, or name the API tier and let the
   subagent discover via `--help`.
3. Tell the subagent to save output to `/tmp/jf-<label>-$$.json`, echo the
   expanded path, and return a structured summary.
4. Specify what to return (counts, lists, specific fields) so the parent can
   assemble the final output without re-reading raw data.
5. Remind the subagent to use `required_permissions: ["full_network"]` on
   every Shell call that contacts the JFrog server.

### Subagent type selection

- Use `subagent_type="shell"` for straightforward command sequences where the
  commands are known ahead of time.
- Use `subagent_type="generalPurpose"` when the subagent needs to read skill
  references, discover commands via `--help`, or adapt its approach based on
  intermediate results.

## When to use each tier

| Scenario | Tier |
|----------|------|
| 2–5 independent reads, same server | 1 (single Shell) |
| Many independent reads where concurrency cuts total runtime | 2 (parallel Shell) |
| Full platform audit, multi-section report, cross-server comparison | 3 (subagents) |
| Task branches need different reference files or reasoning | 3 (subagents) |
| Simple one-shot data fetch | 1 (single Shell) |

## When NOT to parallelize

- A later command depends on the output of an earlier one (use sequential
  calls instead and process the output in between).
- The calls include **mutating operations** — keep those separate so the user
  can review each one.
- Commands would target different servers — only operate on the server(s) the
  user explicitly named (or the default). Never fall back to or iterate
  through other configured servers. See SKILL.md **Server selection rules**.
- The task is small enough that a single Shell call completes in seconds — the
  overhead of launching subagents is not justified.

## Aggregating many outputs (JSONL, logs, ndjson)

Do **not** have multiple background processes append **unsynchronized** to the
same file — lines can interleave and corrupt machine-readable output. Prefer
sequential writes, one file per worker or chunk then concatenate, or file
locking. See `references/general-bulk-operations-and-agent-patterns.md`.
