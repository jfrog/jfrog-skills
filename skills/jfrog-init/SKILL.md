---
name: jfrog-init
description: Set up and verify the JFrog plugin. Run on first install, to complete initial configuration, or to diagnose a broken setup.
disable-model-invocation: true
compatibility: >-
  Requires Node.js 18 or newer, and network access to the JFrog platform.
allowed-tools: Bash(node --version) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-catalog-runtime.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jf-cli.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jf-config.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jfrog-mcp.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-opencode-mcp-auth.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jfrog-mcp-responding.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-project.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-server-ping.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-reinstall-jfrog-plugin.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-state-file.mjs" get*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-state-file.mjs" path*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-resolve-mcp-config.mjs" --harness) Bash(npx --version) Bash(uname:*) AskUserQuestion
metadata:
  role: workflow
---

# /jfrog-init — verify and guide JFrog plugin readiness

**First output must be a tool call, not text.** No "I'll start..." preamble.

Walks a fixed, ordered checklist and stops at the first non-passing result, guiding
the user through the matching fix before re-checking. Every detector in
`scripts/` is idempotent, read-only, JSON-emitting, and implemented in
Node (`.mjs`), so the same detector runs unmodified on macOS, Linux, and
Windows. Step 3's web-login uses this skill's own local `.mjs` scripts,
same as every other step. The one interactive fix step that isn't a Node
script at all is Step 1's Node install itself — a missing Node can't run
a `.mjs` installer, so that one step branches on OS or shell directly.

Approval model — every user-approval point is detailed in its own Step
below (exact wording, `AskUserQuestion` payloads, forbidden phrases);
this is just the map:
- **`node`** — `AskUserQuestion` Yes/No before auto-installing (Step 1).
- **`jf` (JFrog CLI)** — `AskUserQuestion` Yes/No before auto-installing
  (Step 2).
- **`jf config`** — `AskUserQuestion` picker (web login, in-session, vs.
  access token, which never enters this conversation) (Step 3/4).
- **Project selection** — the user answers with a project name or key;
  an `AskUserQuestion` picker offers the first two enumerated projects
  plus "Other" (Step 6).
- Everything else is read-only, except: Step 5's placeholder
  substitution and OpenCode-only `mcp.jfrog` write (both unattended, no
  `AskUserQuestion` — see `references/script-invocation.md`); Step 8's
  `~/.netrc` write (same, see `references/marketplace-setup.md`); and
  the Final summary's state write below.

Step 1's `nvm` install and `jfrog-install-jf-cli.mjs`, Step 3's
web-login scripts, Step 8's `jfrog-add-claude-marketplace.mjs` call,
and the Final summary's `jfrog-state-file.mjs set` call are
deliberately **not** in `allowed-tools` and will raise the harness's
own approval prompt — intended, not a misconfiguration; see
`references/script-invocation.md`.

## Step 0: resolve the `${CLAUDE_SKILL_DIR}` placeholder (do this FIRST)

**`${CLAUDE_SKILL_DIR}` is this skill's own absolute directory** — the
folder holding this `SKILL.md`, `scripts/`, and `references/`. Every
`node "${CLAUDE_SKILL_DIR}/scripts/…"` command below needs it resolved
first.

- **Claude Code** — substitutes it automatically. Run commands as
  written.
- **Every other harness** — you MUST look it up and export it before
  Step 1:
  1. Look up this skill's absolute directory from wherever your
     harness loaded this file (per-harness plugin roots are listed in
     `references/mcp-plugin-config.md`). On OpenCode specifically, it
     announces its own real path in its own preamble — use that value
     directly instead of hunting for it.
  2. Export it:
     ```bash
     export CLAUDE_SKILL_DIR="<absolute path to this skill's directory>"
     ```
  3. Verify with the sentinel — **STOP** and re-resolve if it fails:
     ```bash
     ls "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jf-cli.mjs"
     ```
  4. If your harness does not persist environment variables across
     commands, use the resolved absolute path directly in every
     `node` invocation instead of `${CLAUDE_SKILL_DIR}`.

Skipping this fails silently rather than loudly — see
`references/script-invocation.md` for why. Step 0 resolves *script
paths*; Step 5's `JFROG_INIT_HARNESS` resolves *harness detection*.
Non-Claude harnesses need both.

## At a glance (always-read core)

- **Order matters.** Walk [Steps 1](#step-1-nodejs--18-installed)–[8](#step-8-claude-agent-plugin-marketplace-registered)
  in exact order, stop at the first non-passing result — except Step 5's
  failure/error outcomes, Step 5b entirely, Step 6's one-retry cap, Step 7's "not
  entitled" and "catalog unreachable" outcomes, and Step 8 entirely
  (all five non-blocking). See
  [The checklist, in order](#the-checklist-in-order).
- **Capturing the exit code before forcing success is mandatory** (`;
  rc=$?; true` bash / `; $rc=$LASTEXITCODE; exit 0` PowerShell — see
  `references/invoking-and-output-rules.md`'s "Invoking scripts" section). A
  bare success-forcer with no capture hides every failure/ask result as success.
- **Approval gates:** `AskUserQuestion` Yes/No before auto-installing
  Node (Step 1) or `jf` (Step 2); `AskUserQuestion` picker for
  web-login vs. token (Step 3/4); `AskUserQuestion` picker for project
  selection (Step 6). Everything else is read-only except Step 5's
  placeholder substitution (plus OpenCode `mcp.jfrog` write and kiro-cli
  `~/.kiro/settings/mcp.json` merge), Step 8's `~/.netrc` write, and the
  Final summary's state write.
- **Never surface the checklist.** Run silently — no step narration, no
  raw JSON/exit codes, no branch-reasoning said out loud. See
  `references/invoking-and-output-rules.md`'s "Customer-facing output" section.
- **`<server-id>` for Steps 4-7** always comes from the shared resolver
  (explicit arg → `JF_SERVER_ID` → `isDefault` → sole configured server
  → ask) — never invented, never `jf`'s own fallback. Step 8 reuses the
  same value. See
  [Resolving `<server-id>`](#resolving-server-id-for-steps-4-7).
- **Persist state before the final summary** — run
  `jfrog-state-file.mjs set` whenever Steps 1-4 all pass, regardless of
  Step 5/6/7. See [Final summary](#final-summary).
- **Never store, log, or print an access token** — credentials stay
  inside `jf`'s own process or in-memory for one `fetch` call. **Step 8
  is the one deliberate exception** (writes `~/.netrc`) — see
  [Step 8](#step-8-claude-agent-plugin-marketplace-registered) and
  [Non-goals](#non-goals-out-of-scope-for-this-skill).
- **This skill is the exception to, not a consumer of, the base
  [`../jfrog/SKILL.md`](../jfrog/SKILL.md)'s prerequisites** — do not
  run its environment check as a gate before starting this walk.

Steps: [1](#step-1-nodejs--18-installed) → [2](#step-2-jfrog-cli-installed) →
[3](#step-3-jf-connected-to-a-server) → [4](#step-4-server-reachable--credentials-valid) →
[5](#step-5-jfrog-mcp-plugin-file-has-a-jfrog-entry) → [6](#step-6-project-resolved) →
[7](#step-7-ai-catalog-reachable--user-entitled) →
[8](#step-8-claude-agent-plugin-marketplace-registered)

## Prerequisites

- **Read the base [`../jfrog/SKILL.md`](../jfrog/SKILL.md) for foundational
  context** — JFrog Platform concepts and terminology, and the
  [Server selection rules](../jfrog/SKILL.md#server-selection-rules-mandatory)
  this skill's own "Resolving `<server-id>`" section (below) follows the
  same never-guess/never-infer philosophy of, via its own mechanism.
- **This skill is the exception that makes the base skill's prerequisites
  true, not a consumer of them.** The base skill's
  [environment check](../jfrog/SKILL.md#environment-check) assumes `jf` is
  already installed at a working version — `/jfrog-init` is what gets a
  user from nothing installed to that point. Do not run the base skill's
  environment check as a gate before starting this walk; Steps 1-4 below
  are this skill's own, more granular equivalent (Node, `jf` CLI install,
  connection, credentials) purpose-built for the "nothing works yet" case.
- **Deliberately does not export `JFROG_CLI_USER_AGENT`**, unlike the
  base skill's invariant — see `runJf()` in `scripts/lib/jf.mjs` for why
  (telemetry-only impact).

## Operating rules

**Stop and read `references/invoking-and-output-rules.md` in full before running
any command in this walk** — required behavior, not optional
background. It covers three things:

- **Customer-facing output** — the user never sees step numbers, raw
  JSON/exit codes, or branch-selection reasoning; only asks, failures
  in plain English, and the final summary.
- **Invoking scripts: exit codes are signal, not failure** — every
  detector needs `; rc=$?; true` appended, and every Step's branch
  table below keys off that captured exit code.
- **Flow** — follow the flow literally, no reordering or skipping; see
  `references/flow-diagram.md` for the full map.

## The checklist, in order

1. **Node.js ≥ 18 installed?** — no script; run `node --version` / `npx --version` directly
2. **JFrog CLI (`jf`) installed?** — `scripts/jfrog-detect-jf-cli.mjs`
3. **`jf` connected to a server?** — `scripts/jfrog-detect-jf-config.mjs`
4. **Server reachable + credentials valid?** — `scripts/jfrog-detect-server-ping.mjs [server-id]`
5. **JFrog MCP plugin file has a jfrog entry?** — `scripts/jfrog-detect-jfrog-mcp.mjs [server-id]`, then **is the JFrog MCP server enabled on this JPD?** — `scripts/jfrog-detect-jfrog-mcp-responding.mjs [server-id]` (non-blocking)
   - **5b (OpenCode only): MCP auth token present?** —
     `scripts/jfrog-detect-opencode-mcp-auth.mjs`, runs only when Step 5
     exits 0 and the harness is OpenCode
6. **Project resolved?** — `scripts/jfrog-detect-project.mjs [server-id] [project-input]`
7. **AI Catalog reachable & user entitled?** — `scripts/jfrog-detect-catalog-runtime.mjs [server-id]`
8. **Claude agent-plugin marketplace registered?** — `scripts/jfrog-add-claude-marketplace.mjs [server-id] [project-key]`, Claude Code only

Run detectors in this exact order and stop at the first non-passing
result — except Step 5 going into failure/error (see Step 5), Step 5b entirely
(see Step 5b), Step 6 hitting its one-retry cap (see Step 6), Step 7's
"not entitled" and "catalog unreachable" outcomes (see Step 7), and
Step 8 entirely (see Step 8), all five non-blocking. Step
1 has no script — a Node script can't verify Node exists — so every
step after it is written in Node and can assume Node is present. The
JPD URL is read directly from
`jf config`; there is no separate
`JFROG_PLATFORM_URL` env var. The project key is asked every walk in
Step 6 (the state file at `~/.jfrog/setup.json` may supply a
"reuse the current project?" hint); Step 7's catalog probe takes no
project argument — it only checks catalog reachability and entitlement
for the resolved server.

### Resolving `<server-id>` for Steps 4-7

Order (used by every detector that takes `[server-id]` — resolved
through the single shared `scripts/jfrog-resolve-jf-server.mjs`):

1. Explicit argument passed to the detector.
2. `JF_SERVER_ID` env var.
3. **The server flagged `"isDefault": true`** in `~/.jfrog/jfrog-cli.conf.v6`
   — resolved automatically via `scripts/jfrog-resolve-jf-server.mjs`.
4. If only one server is configured, it is used silently.
5. Otherwise the detector exits **2 ("ask")** with a JSON `candidates`
   list of the configured server IDs. **Stop and read
   `references/server-picker.md` in full** — it has the exact
   `AskUserQuestion` payload for showing the user the actual servers to
   pick from; do not paraphrase or invent your own prompt. Never invent
   a server, never rely on `jf`'s own fallback.

## Step 1: Node.js ≥ 18 installed?

```bash
node --version; true
npx --version; true
```

No script — Node's own binary is the only thing that can answer
"is Node installed", so there's nothing a script would check that
these two commands don't already answer directly. Checked first
because every other script in this walk — including every other
detector — is a Node program. `npx` matters because the JFrog MCP
server (`mcpServers.jfrog`, Step 5) is launched via `npx
@jfrog/agent-guard` — no `npx` means the MCP entry can't start,
regardless of everything else.

Read the output yourself, no JSON to parse:

- Either command errors (e.g. `command not found: node`) → **not usable**:
  Node.js (or `npx`) is not installed / the install is broken.
- `node --version` prints a version like `v16.2.0` → parse the major
  number yourself. `< 18` → **too old**: "Node.js `<version>` is too old —
  jfrog-init requires Node ≥ 18."
- `node --version` ≥ 18 **and** `npx --version` succeeds → proceed to
  Step 2.

**Never paste the raw shell output.** Translate to plain English —
"npx is not installed" not `` `command not found` ``, "Node.js v16 is
too old" not the version string verbatim. The raw output is for your
reasoning, not for the user.

On failure, **stop and read `references/node-install-prompt.md` in full
before responding to the user.** It has the exact `AskUserQuestion`
payload, the forbidden phrases, and the install commands — required
behavior, not optional background. Even on the install path there's no
detector *script*: a missing Node can't run a `.mjs` installer, so the
install is a bash/PowerShell command the model runs directly.

## Step 2: JFrog CLI installed?

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jf-cli.mjs"; rc=$?; true
```

- **Exit 0** → proceed to Step 3.
- **Exit 1, `reason: "missing"`** → `jf` not found on PATH → **stop
  and read `references/jf-cli-install-prompt.md` in full** — required
  behavior, not optional background.
- **Exit 1, `reason: "broken"`** → `jf` is on PATH but hung or
  failed to run → **stop and read `references/jf-cli-install-prompt.md`
  in full** — it has a separate payload for this case; required
  behavior, not optional background.
- **Exit 1, `reason: "outdated"`** → `jf` installed but below the
  required minimum version → **stop and read
  `references/jf-cli-update-prompt.md` in full** — required behavior,
  not optional background.

**Read `references/jf-cli-install-internals.md` for the full plan
A/B/C breakdown** — why this walk uses `npm install -g jfrog-cli-v2-jf`
instead of the base skill's OS-specific install docs, and how the
fallback to a checksum-verified direct binary download works.

## Step 3: `jf` connected to a server?

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jf-config.mjs"; rc=$?; true
```

Checked here (right after installing `jf`) so the JFrog CLI is
finished — install + auth — before the walk moves on to any other
prereqs. Keeps the "get `jf` working" story in one contiguous block
from the user's point of view.

**This step does not pick or validate any specific server** — it only
checks that `jf config show` returns at least one configured server,
regardless of how many there are or whether one is marked `isDefault`.
If multiple servers are configured with none marked default, that
ambiguity is surfaced starting at Step 4, not here — see "Resolving
`<server-id>` for Steps 4-7" above.

- **Exit 0** → proceed to Step 4.
- **Exit 1** → `jf` is installed but not connected to any
  server. **Stop and read `references/jf-config-auth-picker.md` in
  full before responding to the user** — the Step 3 section has the
  exact web-login-vs-token `AskUserQuestion`, this skill's own local
  web-login script copies (no cross-skill call into the base `jfrog`
  skill), and the token command template — required behavior, not
  optional background.

## Step 4: Server reachable + credentials valid?

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-server-ping.mjs" "[server-id]"; rc=$?; true
```

**Stop and read `references/jf-config-auth-picker.md`'s "Step 4's full
branch table" section in full** — the two sub-checks and the required
exit-code branches (credentials-only fix on Exit 1, Exit 2 still
blocks) — required behavior, not optional background.

## Step 5: JFrog MCP plugin file has a jfrog entry?

If you are Kiro, Kiro CLI, Copilot in VS Code, or Devin, run only the matching command below. Silent, like every other setup command in this walk.
(Devin identifies itself from system instructions; no env var carries the signal.)

```bash
JFROG_INIT_HARNESS=kiro node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jfrog-mcp.mjs" "[server-id]"; rc=$?; true
JFROG_INIT_HARNESS=kiro-cli node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jfrog-mcp.mjs" "[server-id]"; rc=$?; true
JFROG_INIT_HARNESS=vscode node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jfrog-mcp.mjs" "[server-id]"; rc=$?; true
JFROG_INIT_HARNESS=devin node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jfrog-mcp.mjs" "[server-id]"; rc=$?; true
  node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jfrog-mcp.mjs" "[server-id]"; rc=$?; true
```

Pass the same `<server-id>` already resolved for Step 4 (empty string
if Step 4 resolved silently via default/single-server) — this reuses
it for the placeholder fix instead of re-resolving from scratch.

**Read-only** against the JFrog plugin's `mcp.json`, with exceptions: substituting
an unresolved `${JFROG_PLATFORM_URL}` / `${JFROG_URL}` placeholder (Cursor / VS Code /
Claude Code), writing a `mcp.jfrog` entry on OpenCode (which has no plugin-owned file),
and adding the `jfrog` entry to `~/.kiro/settings/mcp.json` for kiro-cli (see
`references/mcp-plugin-config.md`).

**Stop and read `references/mcp-plugin-config.md` in full** — substitution mechanics,
per-harness paths, exit-code branches (Exit 1/3 non-blocking, Exit 2 the one that
still blocks), and its **MCP-responding probe** (server enabled + signed in) —
required behavior, not optional.

## Step 5b (OpenCode only): MCP auth token present?

Runs only when Step 5 exits **0** — the exit code, not the JSON
`status` field — and the harness is OpenCode. Determine the harness
the same way Step 8 does, with `detectHarness()`:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-resolve-mcp-config.mjs" --harness
```

If it returns anything other than `opencode`, or Step 5 didn't exit 0,
**skip this step silently** — same treatment as Step 8's preconditions
below. Otherwise, run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-opencode-mcp-auth.mjs"; rc=$?; true
```

**Stop and read `references/mcp-plugin-config.md` in full** for what
this checks, why a non-empty auth-file key isn't proof of a working
token, and the exit-code meanings.

## Step 6: Project resolved?

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-project.mjs" "[server-id]" "[project-input]"; rc=$?; true
```

**State reuse across walks.** Before asking the user for a project,
**stop and read `references/project-state-reuse.md` in full** — it has
the exact "reuse `<KEY>`?" `AskUserQuestion` and the jpdUrl-drift check
this step requires, not optional background.

Name-or-key input is resolved via exact match, then progressively
fuzzier tiers — see `references/project-matching.md` for the algorithm.

**Picking a project, interactively.** Whenever the detector needs the
user to choose — no input was passed, the typed input didn't match
anything (404), or it matched more than one project (ambiguous) —
**stop and read `references/project-picker.md` in full before
responding to the user.** It has the exact `AskUserQuestion` payload
shapes for each case (a 404 with close suggestions, an ambiguous or
missing input, and the no-`AskUserQuestion` plain-text fallback) and
the forbidden-phrasing rules for each — this is required behavior for
the step, not optional background.

**Stop and read `references/project-resolution-branches.md` in full**
for exactly how to branch on the detector's exit code (success / ask /
failure with the one-retry cap / error) — required behavior, not optional
background.

## Step 7: AI Catalog reachable & user entitled?

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-catalog-runtime.mjs" "[server-id]"; rc=$?; true
```

**Stop and read `references/catalog-runtime-branches.md` in full** —
the two sub-checks (anonymous reachability, authenticated entitlement)
and the required exit-code branches (Exit 1 "not hosted/unreachable"
and Exit 4 "not entitled" are both non-blocking; Exit 2 still blocks) —
required behavior, not optional background.

## Step 8: Claude agent-plugin marketplace registered?

Two preconditions, in this order. **Step 7 must have passed (Exit 0)** — the
marketplace is served by the same AI Catalog that Step 7 probes, so
after a non-blocking failure there (unreachable, or not entitled) there is
nothing to register. Then, **Claude Code only** — check the current
harness by reusing `detectHarness()` from
`scripts/jfrog-resolve-mcp-config.mjs` (the same export Step 5b already
uses), e.g.
`node "${CLAUDE_SKILL_DIR}/scripts/jfrog-resolve-mcp-config.mjs" --harness`.

If either precondition fails, **skip this step silently** — never run
the script below, no `AskUserQuestion`, no note anywhere, not even in
the Final Summary. Treat it exactly as if Step 8 didn't exist for this
walk.

Otherwise run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-add-claude-marketplace.mjs" "[server-id]" "[project-key]"; rc=$?; true
```

Pass the same `<server-id>` already resolved for Step 4 (empty string
if Step 4 resolved silently via default/single-server), then Step 6's
canonical project key, or an empty string if Step 6 resolved none.

**Stop and read `references/marketplace-setup.md` in full before
acting on the exit code** — required behavior, not optional
background.

- **Exit 0** → success. The last stdout line is
  `Successfully added marketplace: <marketplace-name>` — extract
  `<marketplace-name>` for the Final Summary's trailing line.
- **Exit 1 or 3** → non-blocking failure. Nothing beyond the Final
  Summary's ⚠️ line, and never volunteer which cause it was.

## Final summary

**Persist the walk's state before rendering any outcome below.**
Whenever Steps 1-4 all pass (regardless of what Step 5/6/7 reported),
run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-state-file.mjs" set "<server-id>" "<jpdUrl>" "<project-key>"; rc=$?; true
```

using the server-id resolved earlier in this walk, Step 4's own
`jpdUrl` field (present in its JSON result when Step 4 passes), and Step 6's project
key — its `resolvedKey` when Step 6 resolves one, or `""` if it never did
(ambiguous input, 404, 403, or the one-retry cap was hit). This is the
only thing that writes `~/.jfrog/setup.json` when the walk is followed
step-by-step; it's the same file Step 6's "reuse `<KEY>`?" prompt
(`project-state-reuse.md`) reads on a future walk, so skipping this call
means that prompt has nothing to offer next time. Skip it only if Steps
1-4 themselves didn't all pass — there's nothing resolved yet to
persist. (Running the whole walk via `jfrog-detect-all.mjs` instead —
see "Running everything at once" below — does this same write itself;
don't call both.)

**Read `references/final-summary-rendering.md` in full** for the exact
recap checklist format, the ⚠️ wording rule per outstanding step, and
Step 8's extra checklist line.

## Running everything at once

**Read `references/batch-walk.md` in full** for `jfrog-detect-all.mjs`'s
exact semantics — the non-blocking exceptions, the JSON summary
fields, and the state-file write behavior.

## Non-goals (out of scope for this skill)

**Read `references/out-of-scope.md` in full** for the exact list — IDE
plugin/VS Code hook install, first-MCP wizard, project-key
persistence, AI Catalog role grants, and access-token handling
(Step 8's `~/.netrc` write is the one deliberate exception).


## Before you run `/jfrog-init` — checklist

[At a glance](#at-a-glance-always-read-core) invariants:

- [ ] Walk Steps 1-8 in exact order; stop at the first non-passing result
      (Step 5's failure/error outcomes, Step 5b entirely, Step 6's retry cap, Step 7
      "not entitled" or "unreachable", and Step 8 entirely are
      non-blocking)
- [ ] Every detector invocation captures then forces success (`; rc=$?;
      true` bash / `; $rc=$LASTEXITCODE; exit 0` PowerShell) — never a
      bare success-forcer with no capture
- [ ] `AskUserQuestion` before auto-installing Node (Step 1) or `jf`
      (Step 2); picker for web-login vs. token (Step 3/4); picker for
      project selection (Step 6)
- [ ] Silent walk — no step narration, no raw JSON/exit codes, no
      branch-reasoning surfaced to the user
- [ ] `<server-id>` for Steps 4-8 comes only from the shared resolver —
      never invented, never `jf`'s own fallback
- [ ] Steps 1-4 all pass → `jfrog-state-file.mjs set <server-id> <jpdUrl>
      <project-key>` before rendering the final summary
- [ ] Never store, log, or print an access token — except Step 8's
      `~/.netrc` write
- [ ] Read the base `../jfrog/SKILL.md` for context; do not run its
      environment check as a gate before this walk
