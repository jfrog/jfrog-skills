---
name: jfrog-init
description: Set up and verify the JFrog plugin. Run on first install, to complete initial configuration, or to diagnose a broken setup.
disable-model-invocation: true
compatibility: >-
  Requires Node.js 18 or newer, and network access to the JFrog platform.
allowed-tools: Bash(node --version) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-catalog-runtime.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jf-cli.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jf-config.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jfrog-mcp.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-project.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-server-ping.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-re*.mjs"*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-state-file.mjs" get*) Bash(node "${CLAUDE_SKILL_DIR}/scripts/jfrog-state-file.mjs" path*) Bash(node -e "import('${CLAUDE_SKILL_DIR}/scripts/jfrog-resolve-mcp-config.mjs').then(function(m){console.log(m.detectHarness())})") Bash(npx --version) Bash(uname:*) AskUserQuestion
metadata:
  role: workflow
---

# /jfrog-init — verify and guide JFrog plugin readiness

Walks a fixed, ordered checklist and stops at the first red result, guiding
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
- Everything else in the walk is read-only, except Step 5's placeholder
  substitution (writes the plugin's `mcp.json`, unattended by design —
  no `AskUserQuestion`, see `references/script-invocation.md`), Step 8's
  `~/.netrc` write (also unattended, no `AskUserQuestion` — see
  `references/marketplace-setup.md`), and the Final summary's state
  write below.

Step 1's `nvm` install and `jfrog-install-jf-cli.mjs`, Step 3's
web-login scripts, Step 8's `jfrog-add-claude-marketplace.mjs` call,
and the Final summary's `jfrog-state-file.mjs set` call are
deliberately **not** in `allowed-tools` and will raise the harness's
own approval prompt — intended, not a misconfiguration; see
`references/script-invocation.md`.

`${CLAUDE_SKILL_DIR}` below is this file's own directory. Claude Code
substitutes it automatically, identically, in both this text and the
`allowed-tools` Bash rules above — write it literally rather than
resolving it yourself, so the two stay byte-for-byte consistent
regardless of install depth (see `references/script-invocation.md`). On
a harness that doesn't perform this substitution (e.g. Cursor, which
doesn't consult `allowed-tools` for approval at all — every command
below still raises its own prompt there), replace it with the real
absolute path of this file's directory yourself, same as before.

## At a glance (always-read core)

- **Order matters.** Walk [Steps 1](#step-1-nodejs--18-installed)–[8](#step-8-claude-agent-plugin-marketplace-registered)
  in exact order, stop at the first non-green result — except Step 5
  red/error, Step 6's one-retry cap, Step 7's "not entitled" and
  "catalog unreachable" outcomes, and Step 8 entirely (all four
  non-blocking). See
  [The checklist, in order](#the-checklist-in-order).
- **`rc=$?` is mandatory** on every detector invocation — see
  [Invoking scripts](#invoking-scripts-avoid-the-red-error-framing). A
  bare `; true` hides every red/ask result as green.
- **Approval gates:** `AskUserQuestion` Yes/No before auto-installing
  Node (Step 1) or `jf` (Step 2); `AskUserQuestion` picker for
  web-login vs. token (Step 3/4); `AskUserQuestion` picker for project
  selection (Step 6). Everything else is read-only except Step 5's
  placeholder substitution, Step 8's `~/.netrc` write, and the Final
  summary's state write.
- **Never surface the checklist.** Run silently — no step narration, no
  raw JSON/exit codes, no branch-reasoning said out loud. See
  [Customer-facing output](#customer-facing-output).
- **`<server-id>` for Steps 4-7** always comes from the shared resolver
  (explicit arg → `JF_SERVER_ID` → `isDefault` → sole configured server
  → ask) — never invented, never `jf`'s own fallback. Step 8 reuses the
  same value. See
  [Resolving `<server-id>`](#resolving-server-id-for-steps-4-7).
- **Persist state before the final summary** — run
  `jfrog-state-file.mjs set` whenever Steps 1-4 are green, regardless of
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

## Customer-facing output

**The user does not need to see the checklist you are walking, but does
need to see what actually happened.** Run the detectors silently,
capture their output for your own reasoning, and surface only what the
user needs to know or act on:

- **Do not** narrate step numbers ("Step 1…", "moving to Step 3…")
  while the walk is in progress.
- **Do not** paste detector JSON, exit codes, or shell command output
  into the reply.
- **Do not** narrate the branch-selection reasoning behind an
  `AskUserQuestion` or plain-text prompt — e.g. explaining that
  `unresolved` wasn't `"server"`, or that `candidatesWithNames` had two
  or more entries, so this is "the generic ask using the first two
  candidates." That reasoning (in `server-picker.md`, `project-picker.md`,
  and the other reference docs' branch tables) is written for you to
  follow silently, not to summarize out loud — the field names in it are
  never user-facing. The only output the user sees at an ask point is
  the prompt itself.
- **Do not** announce that you're about to run the checklist, or name
  which check comes first — not even generically ("I'll run the setup
  checklist silently, starting with the JFrog CLI check" is itself a
  violation: it names a step while claiming to be silent). Silently
  means no preamble message at all. Say nothing until you have
  something the user needs to act on (an ask, a red result) or the
  final summary.

Instead:

- **When everything passes**, give a short recap in the final summary
  (see "Final summary" below): a short, emoji-based checklist — JF CLI
  & Config, JFrog MCP Plugin, Project & AI Catalog — so the user sees
  the end state of every check at a glance, not raw step numbers and
  not the Node.js check (an implementation detail, not user-facing).
- **When something is red**, say *what's wrong in plain English* and
  *what the user needs to do next*, in one or two sentences. Show the
  exact command they need to run (they must see what they're
  approving).
- **On failure, the raw detector error line is fair game** to include
  verbatim as a debugging aid — one line, without the JSON wrapper.

The rest of this file documents the flow **for you (the model)**, not
for the user.

## Invoking scripts: avoid the red "Error" framing

Every detector command shown below signals red/ask states via a
non-zero exit code, by design — append `; rc=$?; true` when invoking
any of them. **`rc=$?` is not optional**: every Step's branch table
below keys off the exit code, and a bare `; true` throws it away, so
every red and ask silently reads as green. **Read
`references/script-invocation.md` in full** before running any command
in this walk — the exact pattern and why it's required, not optional
background.

## Flow

**Follow this flow literally.** Every decision node is covered by a
detector or fix script below; every user-facing prompt uses the exact
wording documented in the corresponding step. Do not reorder, do not
skip, do not narrate the diagram to the user. Read
`references/flow-diagram.md` for the full flowchart before starting a
walk — the same logic as the Steps below, drawn as a map.

## The checklist, in order

1. **Node.js ≥ 18 installed?** — no script; run `node --version` / `npx --version` directly
2. **JFrog CLI (`jf`) installed?** — `scripts/jfrog-detect-jf-cli.mjs`
3. **`jf` connected to a server?** — `scripts/jfrog-detect-jf-config.mjs`
4. **Server reachable + credentials valid?** — `scripts/jfrog-detect-server-ping.mjs [server-id]`
5. **JFrog MCP plugin file has a jfrog entry?** — `scripts/jfrog-detect-jfrog-mcp.mjs [server-id]`
6. **Project resolved?** — `scripts/jfrog-detect-project.mjs [server-id] [project-input]`
7. **AI Catalog reachable & user entitled?** — `scripts/jfrog-detect-catalog-runtime.mjs [server-id]`
8. **Claude agent-plugin marketplace registered?** — `scripts/jfrog-add-claude-marketplace.mjs [server-id]`, Claude Code only

Run detectors in this exact order and stop at the first non-green
result — except Step 5 going red/error (see Step 5), Step 6 hitting
its one-retry cap (see Step 6), Step 7's "not entitled" and "catalog
unreachable" outcomes (see Step 7), and Step 8 entirely (see Step 8),
all four non-blocking. Step
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

- Either command errors (e.g. `command not found: node`) → **red**:
  Node.js (or `npx`) is not installed / the install is broken.
- `node --version` prints a version like `v16.2.0` → parse the major
  number yourself. `< 18` → **red**: "Node.js `<version>` is too old —
  jfrog-init requires Node ≥ 18."
- `node --version` ≥ 18 **and** `npx --version` succeeds → **green** →
  proceed to Step 2.

On red, **stop and read `references/node-install-prompt.md` in full
before responding to the user.** It has the exact `AskUserQuestion`
payload, the forbidden phrases, and the install commands — required
behavior, not optional background. Even on the install path there's no
detector *script*: a missing Node can't run a `.mjs` installer, so the
install is a bash/PowerShell command the model runs directly.

## Step 2: JFrog CLI installed?

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jf-cli.mjs"; rc=$?; true
```

- **Exit 0 (green)** → proceed to Step 3.
- **Exit 1 (red), `reason: "missing"`** → `jf` not found on PATH → **stop
  and read `references/jf-cli-install-prompt.md` in full** — required
  behavior, not optional background.
- **Exit 1 (red), `reason: "broken"`** → `jf` is on PATH but hung or
  failed to run → **stop and read `references/jf-cli-install-prompt.md`
  in full** — it has a separate payload for this case; required
  behavior, not optional background.
- **Exit 1 (red), `reason: "outdated"`** → `jf` installed but below the
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

- **Exit 0 (green)** → proceed to Step 4.
- **Exit 1 (red)** → `jf` is installed but not connected to any
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

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-jfrog-mcp.mjs" "[server-id]"; rc=$?; true
```

Pass the same `<server-id>` already resolved for Step 4 (empty string
if Step 4 resolved silently via default/single-server) — this reuses
it for the placeholder fix instead of re-resolving from scratch.

**Read-only against the JFrog plugin's own `mcp.json` — with one
exception: automatic placeholder substitution** of an unresolved
`${JFROG_PLATFORM_URL}` / `${JFROG_URL}` with the real JPD URL from
`jf config`.

**Stop and read `references/mcp-plugin-config.md` in full** — exactly
how the substitution works, the per-harness plugin-config paths, and
the required exit-code branches (Exit 1/3 non-blocking, Exit 2 the one
outcome that still blocks) — required behavior, not optional
background.

## Step 6: Project resolved?

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-project.mjs" "[server-id]" "[project-input]"; rc=$?; true
```

**State reuse across walks.** Before asking the user for a project,
**stop and read `references/project-state-reuse.md` in full** — it has
the exact "reuse `<KEY>`?" `AskUserQuestion` and the jpdUrl-drift check
this step requires, not optional background.

**Where the project list comes from.** `jfrog-detect-project.mjs` fetches
`GET <JPD>/access/api/v1/projects` (the
[GetProjectsList](https://docs.jfrog.com/projects/reference/getprojectslist)
endpoint, authenticated with credentials from `jf config export`) once
per walk and caches it in memory for a short TTL (`lib/project-cache.mjs`)
— the interactive picker re-invokes this script once per user attempt,
and re-enumerating on every typed guess would be wasted network traffic.
This is the list every "enumerated project list" / `candidatesWithNames`
reference below draws from.

**Name-or-key input.** The user answers with **either** the project's
canonical key OR its display name — whichever is easier for them.
`jfrog-detect-project.mjs` resolves it against the enumerated project
list (exact key, exact name, then progressively fuzzier tiers — see
`references/project-matching.md` for the exact algorithm), confirms
existence, and emits the canonical key on green in the JSON
`resolvedKey` field. An ambiguous input exits red with `candidates`
listing the tied keys.

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
for exactly how to branch on the detector's exit code (green / ask /
red with the one-retry cap / error) — required behavior, not optional
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

Two preconditions, in this order. **Step 7 must have been green** — the
marketplace is served by the same AI Catalog that Step 7 probes, so
after a non-blocking red there (unreachable, or not entitled) there is
nothing to register. Then, **Claude Code only** — check the current
harness by reusing `detectHarness()` from
`scripts/jfrog-resolve-mcp-config.mjs` (the same export Step 5 already
uses), e.g.
`node -e "import('${CLAUDE_SKILL_DIR}/scripts/jfrog-resolve-mcp-config.mjs').then(function(m){console.log(m.detectHarness())})"`.

If either precondition fails, **skip this step silently** — never run
the script below, no `AskUserQuestion`, no note anywhere, not even in
the Final Summary. Treat it exactly as if Step 8 didn't exist for this
walk.

Otherwise run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-add-claude-marketplace.mjs" "[server-id]"; rc=$?; true
```

Pass the same `<server-id>` already resolved for Step 4 (empty string
if Step 4 resolved silently via default/single-server).

**Stop and read `references/marketplace-setup.md` in full before
acting on the exit code** — required behavior, not optional
background.

- **Exit 0 (green)** → success. The last stdout line is
  `Successfully added marketplace: <marketplace-name>` — extract
  `<marketplace-name>` for the Final Summary's trailing line.
- **Exit 1 or 3 (red)** → non-blocking failure. Say **nothing** —
  exactly as in the skip above, not even in the Final Summary, and never
  volunteer which cause it was.

## Final summary

**Persist the walk's state before rendering any outcome below.**
Whenever Steps 1-4 are green (regardless of what Step 5/6/7 reported),
run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-state-file.mjs" set "<server-id>" "<jpdUrl>" "<project-key>"; rc=$?; true
```

using the server-id resolved earlier in this walk, Step 4's own
`jpdUrl` field (present on its green JSON result), and Step 6's project
key — its `resolvedKey` on green, or `""` if Step 6 never resolved one
(ambiguous input, 404, 403, or the one-retry cap was hit). This is the
only thing that writes `~/.jfrog/setup.json` when the walk is followed
step-by-step; it's the same file Step 6's "reuse `<KEY>`?" prompt
(`project-state-reuse.md`) reads on a future walk, so skipping this call
means that prompt has nothing to offer next time. Skip it only if Steps
1-4 themselves didn't all pass — there's nothing resolved yet to
persist. (Running the whole walk via `jfrog-detect-all.mjs` instead —
see "Running everything at once" below — does this same write itself;
don't call both.)

**Give the user a short recap, not the raw checklist.** See
"Customer-facing output" above — no step numbers, no raw JSON. Render a
short, emoji-based checklist, not a prose paragraph or a five-line
plain-text list. Three grouped lines cover all five checks:

- **JF CLI & Config** — Steps 2-4 (`jf` installed and connected to a
  server). Always fully resolved here — this checklist only renders
  once Steps 1-4 all passed (see "Anything else red" below for the
  alternative).
- **JFrog MCP Plugin** — Step 5.
- **Project & AI Catalog** — Steps 6 and 7 together.

Skip Node.js (Step 1) — implementation detail, not user-facing.

**Rules for the checklist:**
1. Do **not** use the word "done" anywhere in it.
2. Keep it to exactly these three grouped lines — never expand back out
   to five.
3. All three groups fully resolved → use this exact format, verbatim:

   > ✨ **JFrog initialization complete!**
   > ✅ JF CLI & Config
   > ✅ JFrog MCP Plugin
   > ✅ Project & AI Catalog

4. A group with something outstanding gets ⚠️ instead of ✅, plus a
   short fact after an em dash:

   > ✨ **JFrog initialization complete!**
   > ✅ JF CLI & Config
   > ⚠️ JFrog MCP Plugin — not configured
   > ✅ Project & AI Catalog

   For the merged **Project & AI Catalog** line, if only one of the two
   is outstanding name just that one; if both are, separate them with a
   semicolon: `⚠️ Project & AI Catalog — project not set up yet; catalog
   access not entitled`.

5. **Step 8's outcome is never a fourth checklist line** — still exactly
   three grouped lines above. On Claude Code only, append one trailing
   sentence after the checklist block:
   - **Success** — this exact wording, do not reword it:

     > Added the JFrog marketplace `<marketplace-name>` to Claude Code.
     > Browse available plugins with `/plugins`, or install directly with
     > `claude plugin install <plugin>@<marketplace-name>`

   - **Failed/error, or skipped** — nothing.

Never phrase a ⚠️ line as a failure or as something the user needs to
fix before continuing — these three are non-blocking by design. The
short fact after the em dash is the same underlying cause this skill
has always surfaced, just worded without "pending":

- **Step 5 red/error (MCP plugin not configured):** `not configured`.
  If the user asks why or how to fix it, that's when the specific cause
  from Step 5's `detail` comes in — either run
  `jfrog-reinstall-jfrog-plugin.mjs` (see Step 5) for the per-harness
  reinstall remedy, or point at resolving `jf config`, matching
  whichever cause Step 5 actually reported.
- **Step 6 hit its retry cap (no project resolved):** `project not set
  up yet`. If the user asks, mention they can pick one whenever they're
  ready. The server/JPD are still recorded to the state file either way
  (see the persistence step at the top of this section); a project
  picked in an earlier walk, if any, is left as-is rather than cleared.
- **Step 7 returned exit 4 (not entitled):** `catalog access not
  entitled`. If the user asks for the fix: ask your JFrog admin for the
  "AI Catalog Read" role to browse or install MCPs from the catalog.
- **Step 7 returned exit 1 (catalog not hosted / unreachable):**
  `catalog not reachable on this JPD`. No fix instruction; there may be
  nothing to fix (this JPD may simply not host the AI Catalog).
- **Something happened this walk** (Node.js/`jf` CLI installed, `jf
  config` connected, a project resolved in Step 6, an MCP placeholder
  substituted in Step 5, etc.): still the same checklist — the action
  itself isn't called out per-line, ✅ is ✅ regardless of whether it
  needed fixing this walk.
- **Anything else red** (Steps 1-4 not all green): one or two sentences
  naming what's blocking and what to do next, no checklist — there's
  nothing to check off yet. Include the raw detector error line if it
  helps debug, without the JSON wrapper.

## Running everything at once

**Read `references/batch-walk.md` in full** for `jfrog-detect-all.mjs`'s
exact semantics — the non-blocking exceptions, the JSON summary
fields, and the state-file write behavior.

## Non-goals (out of scope for this skill)

- Installing the JFrog IDE plugin, or replacing its auto-config.
- Installing the VS Code hook.
- A first-MCP wizard for an empty catalog.
- Persisting the picked **project key** to `JF_PROJECT` or any shell
  profile. Step 6 asks every walk and threads the pick forward as a
  positional argument only — nothing about project selection ever
  touches a shell profile. (Two other, unrelated things in this walk
  *do*: Step 1's `nvm`-based Node install, and Step 2's Plan C fallback
  when npm itself isn't usable — both append one PATH line to the
  user's shell rc file, disclosed up front in the install consent
  prompts, see `node-install-prompt.md` / `jf-cli-install-prompt.md`.
  Plans A/B of Step 2 — the common case — don't touch a shell profile
  at all, relying on npm's own global bin directory instead.)
- Granting AI Catalog roles/permissions — Step 7 only instructs.
- Storing access tokens to disk, logging them, or printing them.
  Step 4's authenticated check keeps the credential inside `jf`'s own
  process (`jf rt ping`); Steps 6 and 7 extract it from `jf config
  export` only in memory, for one `fetch` call. Step 3/4's token-based
  `jf config` path (see `references/jf-config-auth-picker.md`) never
  touches this skill or the model at all — the user runs that command
  themselves. **Step 8 is the one deliberate exception** — it writes
  the token to `~/.netrc`; see `references/marketplace-setup.md`.

## Before you run `/jfrog-init` — checklist

[At a glance](#at-a-glance-always-read-core) invariants:

- [ ] Walk Steps 1-8 in exact order; stop at the first non-green result
      (Step 5 red/error, Step 6's retry cap, Step 7 "not entitled" or
      "unreachable", and Step 8 entirely are non-blocking)
- [ ] Every detector invocation appends `; rc=$?; true` — never a bare
      `; true`
- [ ] `AskUserQuestion` before auto-installing Node (Step 1) or `jf`
      (Step 2); picker for web-login vs. token (Step 3/4); picker for
      project selection (Step 6)
- [ ] Silent walk — no step narration, no raw JSON/exit codes, no
      branch-reasoning surfaced to the user
- [ ] `<server-id>` for Steps 4-8 comes only from the shared resolver —
      never invented, never `jf`'s own fallback
- [ ] Steps 1-4 green → `jfrog-state-file.mjs set <server-id> <jpdUrl>
      <project-key>` before rendering the final summary
- [ ] Never store, log, or print an access token — except Step 8's
      `~/.netrc` write
- [ ] Read the base `../jfrog/SKILL.md` for context; do not run its
      environment check as a gate before this walk
