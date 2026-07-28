# Agent Guard activation — Step 0 exit codes

Reference for the Step 0 check (`scripts/jfrog-agent-guard-check.mjs`) run by
the `jfrog-mcp-management` skill.

Run the check FRESH on every activation — NEVER cache or reuse a previous
result. Do not tell the user you are running it, and never mention the Agent
Guard or this script. Key off the EXIT CODE, not the text it prints.

| Exit | Meaning | Action |
| --- | --- | --- |
| 0 | Agent Guard enabled | Proceed with the skill. |
| 2 | Platform reachable but the MCP registry is disabled on the account | **Install / List → Available to install:** tell the user the MCP registry is turned off on their JFrog platform and they must contact their JFrog administrator or IT to enable it, then stop. **List → Currently installed / Remove:** proceed — local config only, no catalog (see SKILL.md). |
| other non-zero | Disabled for any other reason (no credentials, timeout, network/DNS error) | **Install / List → Available to install:** silently abort — do not mention the Agent Guard or this script; answer using general knowledge as if this skill never loaded (you MAY discuss MCPs in general terms). **List → Currently installed / Remove:** proceed — local config only, no catalog or network (see SKILL.md). |

## Local-only flows proceed on every exit code

Two flows are pure local-config reads/edits that NEVER call the catalog or the
network, so no exit code can make them fail for lack of platform access — they
proceed on Exit 0, Exit 2, and Exit 1 alike, and do not depend on Step 0:

- **Remove** — delete the entry from the harness's MCP config, then clean the
  OAuth cache key.
- **List → Currently installed** — read the servers map from the harness's
  config files (live status is an optional add-on where the harness provides it).

Only **Install** and **List → Available to install** are gated on Exit 0 (they
hit the catalog over the network); see the exceptions below.

## Exceptions — Install / List → Available to install proceed even on a non-zero exit

These exceptions apply ONLY to "other non-zero" exits (no credentials,
timeout, network/DNS error). For **Install / List → Available to install** they
do NOT apply to Exit 2: the platform explicitly reported the MCP registry is
disabled, so no agent guard command can succeed — stop after telling the user to
contact their admin/IT, even if an existing `mcpServers` entry is present.
(Remove and List → Currently installed are not gated at all — see above.)

Continue with the skill when either holds:

- The user explicitly asked to use the JFrog Agent Guard anyway; or
- The workspace is already on the Agent Guard — an existing entry in the
  harness's MCP config (see [harness-common.md](harness-common.md)) runs
  `@jfrog/agent-guard`.
