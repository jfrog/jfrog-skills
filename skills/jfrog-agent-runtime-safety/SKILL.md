---
name: jfrog-agent-runtime-safety
description: >-
  Protect agent-driven JFrog mutations with HOL Guard at the supported local
  coding-agent harness boundary. Use when the user wants pre-tool policy,
  review, and execution evidence before state-changing JFrog CLI workflows.
metadata:
  role: workflow
---

# JFrog Agent Runtime Safety with HOL Guard

## At a glance (always-read core)

- Read `../jfrog/SKILL.md` first for JFrog CLI setup, authentication, server targeting, and API conventions.
- HOL Guard protects the supported local agent harness before tools run. It does not run inside JFrog Platform.
- Keep JFrog permissions, scopes, native previews, and product-specific safety checks intact.
- Do not claim the current agent session is protected merely because `hol-guard` is installed.
- If Guard blocks or requests review, stop before the JFrog mutation.

## Set up HOL Guard

Install the local runtime in an isolated CLI environment if needed:

```bash
pipx install hol-guard
hol-guard status
hol-guard detect --json
```

Use the exact supported harness identifier returned by `hol-guard detect --json`:

```bash
hol-guard install <harness>
hol-guard run <harness> --dry-run
hol-guard run <harness>
hol-guard doctor <harness> --json
```

Continue the JFrog workflow from the Guard-launched protected harness. Preserve the active `jf` server configuration and the requirements of the JFrog workflow skill you are using.

## Protected JFrog mutations

Use this workflow for agent-driven commands that can change JFrog state, including uploads, promotions, repository or permission changes, build actions, policy changes, curation changes, or other writes.

Before executing the mutation:

1. Confirm the intended JFrog server, project, repository, build, package, or policy target using the relevant JFrog skill.
2. Use JFrog-native read, preview, or dry-run behavior when that workflow provides it.
3. Confirm the local harness is running through HOL Guard.
4. If Guard returns a block or review request, do not issue the JFrog write.
5. After an explicit allowed path, execute the JFrog action exactly once with the original JFrog scope.

HOL Guard is an additional local execution boundary. It does not replace JFrog RBAC, access tokens, Xray, Curation, AppTrust, or Audit Trail.

## Review and evidence

If Guard queues work for review:

```bash
hol-guard approvals
hol-guard approvals open
hol-guard receipts
hol-guard diff <harness>
```

For troubleshooting or handoff evidence:

```bash
hol-guard status
hol-guard doctor <harness> --json
hol-guard receipts
hol-guard events
```

Only approve after checking both the Guard reason and the JFrog target/scope. Guard receipts describe the local agent execution boundary; use JFrog-native audit data for authoritative JFrog-side activity records.

## Verify third-party agent packages

HOL Guard's package scanner is a separate CLI. Use it when reviewing an Agent Skill, plugin, or MCP package before trust:

```bash
pipx install plugin-scanner
plugin-scanner lint <path>
plugin-scanner verify <path>
```

Package verification and runtime authorization are separate checks. A clean scan does not authorize a later JFrog mutation.

## Before you run a JFrog mutation checklist

- [ ] Read `../jfrog/SKILL.md` and any workflow-specific skill needed for the task.
- [ ] Confirm the intended JFrog server and resource scope.
- [ ] Confirm `hol-guard detect --json` reports a supported local harness.
- [ ] Run the JFrog mutation from the Guard-launched protected harness.
- [ ] Stop on Guard block/review/error instead of bypassing it.
- [ ] Preserve JFrog-native permissions, previews, and audit controls.

## References

- HOL Guard: https://github.com/hashgraph-online/hol-guard
- HOL Guard Agent Skill: https://github.com/hashgraph-online/hol-guard-plugin/tree/main/skills/hol-guard
- JFrog Skills: https://github.com/jfrog/jfrog-skills
