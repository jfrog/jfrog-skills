# Key rules & troubleshooting

Reference for the Install and List flows of the `jfrog-mcp-management` skill.

## Key Rules

- **Package scope is case-sensitive — ALWAYS write it lowercase as
  `@jfrog/agent-guard`, NEVER `@JFrog/agent-guard`.** npm scopes are
  case-sensitive; the published package is the lowercase `@jfrog/agent-guard`.
  Capitalizing the brand (`@JFrog`) points at a different/nonexistent scope and
  breaks the command. Use the exact lowercase string in every command and config
  entry.
- **`npx` arg order:** `--yes`, `--registry "<REGISTRY_URL>"`, `@jfrog/agent-guard`, then
  agent guard flags. Canonical invocation:
  `npx --yes --registry "<REGISTRY_URL>" @jfrog/agent-guard`. Both `--yes` and
  `--registry` MUST precede the package name or `npx` falls back to the default
  registry (404) and may block on a no-TTY prompt.
- **Always `"type": "stdio"`** pointing at
  `npx --yes --registry "<REGISTRY_URL>" @jfrog/agent-guard`, even for
  remote-only catalog MCPs (the agent guard proxies them). `"http"`, `"sse"`,
  or a top-level `"url"` bypass the agent guard. **One exception:** when
  `--inspect` returned `routing.target: "gateway"` with a non-empty
  `routing.url` and your harness file defines a Gateway entry shape, write that
  shape — it points at the tenant's own JFrog Platform, not at a third party,
  so nothing is bypassed. Never write a remote entry on any other basis.
- `_JF_ARGS` is **only** for the config entry the agent launches at session
  start (the `env` of the entry written when adding an MCP); MUST contain
  `project=<JFROG_PROJECT_KEY>&mcp=<PACKAGE_NAME>`. NEVER pass `_JF_ARGS` to
  `--list-available`, `--inspect`, or `--login` — those take `--server` /
  `--project` / `--mcp` as CLI flags only. Conversely, NEVER put `--project`
  or `--mcp` in the config entry's `args` — that is CLI-only; config uses
  `_JF_ARGS`.
- **Three invocation contracts — do not mix:** (1) Step 0 gate
  `jfrog-agent-guard-check.mjs` — optional positional jf `<SERVER_ID>` only,
  no flags; (2) catalog CLI — `--server` / `--project` / `--mcp` flags;
  (3) config stdio entry — `_JF_ARGS=project=…&mcp=…`, optional `--server`
  in `args` only when not on the env URL+token path.
- `<SERVER_ID>` is always a `jf config` server id. NEVER an MCP package
  name, NEVER a URL, and NEVER a hostname you derived from `JFROG_URL` /
  `JF_URL`. Hostname-shaped ids from `jf config show` itself are fine —
  the ban is on parsing an id out of the URL, not on the shape of the
  value.
- NEVER assume `default` as a JFrog project key. If the project key is unknown
  after the project chain (existing `mcpServers` entries → `JF_PROJECT` env
  var), STOP and ask the user. Same for server ID if used. NEVER invent or
  guess JFrog project keys or server IDs.
- Package name MUST come from the catalog (`--inspect` / `--list-available`).
  NEVER guess. NEVER install MCPs outside the agent guard. NEVER use
  Fetch/WebFetch for catalog calls.
- **Non-zero Agent Guard exit → classify, never invent a fallback install.**
  Retryable fingerprints retry; catalog miss → List; **any other stderr is a
  hard stop** (show it, do not retry, do not fall back to the usual MCP install
  routes that skip the approved catalog and Agent Guard as the MCP proxy). See
  [Classify npx @jfrog/agent-guard failures](#classify-npx-jfrogagent-guard-failures).
- NEVER pipe a catalog command through `python3`, and NEVER capture it with
  `2>&1` — `npx`/`npm` writes progress to stderr, which corrupts the output
  stream. For `--list-available` present the compact TSV it prints; for
  `--inspect` read the JSON it prints on stdout directly (or with a single `jq`
  filter), never via `python3`.
- NEVER write a raw secret into any MCP config file (see
  [harness-common.md](harness-common.md) for each harness's file) — always use
  `${VAR_NAME}`. NEVER show tokens / API keys.
- NEVER try multiple servers — ask the user to pick one.

## Classify npx @jfrog/agent-guard failures

Show the error verbatim. Ignore `npm warn` noise — except `npm warn invalid
config registry=…`, which names the cause of a self-inflicted E404. Match
**one** bucket from stderr. Fingerprints below are the live strings; if a
match fails, re-check
`npx --yes --registry "<REGISTRY_URL>" @jfrog/agent-guard --version` rather
than assuming a pinned release. A **hard stop** means: do not fall back to
the usual MCP install routes that skip the approved catalog and Agent Guard
as the MCP proxy.

1. **Package unreachable (hard stop).** `npm error code E404`, `npm error 404`,
   npx package-fetch **403**, DNS/`ENOTFOUND`, timeout/`ETIMEDOUT`, connection
   refused/`ECONNREFUSED`. Agent Guard never started. Two self-inflicted causes
   look identical to a real outage, so rule both out first: (a) `--yes` and
   `--registry <REGISTRY_URL>` must precede `@jfrog/agent-guard`, and (b)
   `<REGISTRY_URL>` must be substituted with a real URL — npm discards an
   invalid `--registry` value, falls back to the default registry, and returns
   the same E404, so compare it against the URL npm reports contacting. Fix and
   retry if either is wrong. Otherwise tell the user the registry could not be
   reached, point them at [Troubleshooting](#troubleshooting) (proxy/VPN,
   blocked or wrong registry, curation policy), and **stop**.
2. **Catalog miss (retry via List).** `not found in curated list` — the catalog
   responded; that MCP name is not approved. Go to List → Available to install.
   Same fingerprint on `--login`. A wrong `--project` key can surface as this
   miss on the MCP name — re-resolve the project key if List is empty.
3. **Retryable CLI/config.** `--project flag is required`, `--mcp flag is required`,
   `Server ID '…' does not exist.`, `multiple/no JFrog server configured`. Fix
   per Troubleshooting / Pre-flight and retry the **same** Agent Guard command.
4. **Any other non-zero (hard stop).** Unrecognized stderr (including
   `Unauthorized`, `failed to fetch catalog`, `_JF_ARGS environment variable is not set`,
   5xx). Show it verbatim. Do not retry List. Do not guess another bucket.
   Carve-out: `--login` `expected 401, got 200` is anonymous MCP — ignore, not
   this bucket.

## Connected but 0 tools

The harness shows the server connected/running but this agent still has no
tools from that server (none you can see or call). Agent Guard (the proxy)
is up; upstream tools are not visible. Do not report success. If this
session already has an upstream tool from that server, this section does not apply.

Run the steps in order. Do not skip a step, including because you think you
already know the answer. When a step says re-run **Verify**,
use this harness's **Verify** section. Do not invent another
check, script, or debug path until these steps are finished.

Expected flow: when the upstream is ready, Agent Guard sends MCP
`tools/list_changed` and the harness updates the tool list. Re-check this
harness's **Verify**. If the harness does not hot-refresh, the user must
apply that harness's **Restart**.

**Restart** means the action in this harness's **Restart** section (new
agent session / reload). It does not mean rebooting the machine or a
separate MCP-only command.

Typical reasons:
- Upstream still starting (download, install, first launch).
- Not allowed in this JFrog project (allowlist is dynamic).
- Upstream failed to start (missing env, expired token, runtime/spawn error).
- The harness session was not running. Agent Guard and the upstream start
  when the harness starts — waiting with it closed does not count.

Steps:
1. If the config changed and this harness's **Restart** has not run since,
   do that first.
2. Re-run Verify (including now). ≥1 tool → success. Stop.
3. List → Available to install (`--list-available`). Confirm this MCP is
   still in the catalog for this project. A recent `--inspect` is not this
   check — allowlist membership is dynamic, and a wrong project key looks
   the same as one that is still starting.
4. Re-run Verify. ≥1 tool → success. Stop.
5. Still empty: **stop**. Do not gather logs in this turn. Tell the user
   once that after Restart the upstream may take up to a few minutes. 
   They can say **check again**. Do not guess how long, and
   do not send them away to wait. If they waited with the harness closed,
   the MCP was not running — the wait starts after Restart.
6. After **check again**, or if they ask to debug further: re-run Verify.
   ≥1 tool → success. Stop. How long it has already been is not a
   diagnosis.
7. Still empty with the harness running after Restart — gather logs:
   - Set `JF_AGENT_GUARD_LOG_LEVEL=debug` on the Agent Guard entry's env,
     then Restart, and read Agent Guard stderr.
   - If the harness has a debug mode (e.g. Claude Code `claude --debug`),
     relaunching in that mode can add more log output.
   From stderr:
   - **OAuth (remote)** — re-run `--login`.
   - **Static-token (remote)** — this harness's **Value reference** is set.
   - **Local (stdio)** — spawn/runtime error.
   Last resort: run the same command as the config entry in a terminal
   (`npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard` plus that
   entry's `--server` / `_JF_ARGS`, with `JF_AGENT_GUARD_LOG_LEVEL=debug`).
   This is an MCP stdio process — it will block until you stop it. Read
   stderr. Do not start by writing a wrapper script.

## Troubleshooting

Items below are harness-agnostic unless they point into the current harness's
row in [harness-common.md](harness-common.md).

- **An MCP was installed as a `stdio` Agent Guard entry although Gateway
  routing is expected** — this is the designed fallback, not a failure.
  `--inspect` returns anything other than
  `routing.target: "gateway"` for every non-Gateway outcome, and the skill then
  writes the standard stdio Agent Guard entry. Which outcomes those are is
  `--inspect`'s to decide, not this skill's. The same fallback is taken when
  `routing.url` is empty, or when the harness file defines no Gateway entry
  shape — an MCP whose `routing.target` is `"gateway"` still installs as stdio
  on those harnesses. The fallback entry is an ordinary Agent Guard entry, so
  it works **only** with its inputs: Install Steps 3 and 4a run in full on that
  path, and the required values must be collected and exported as for any other
  stdio install. If a developer explicitly asks
  why, the reason is on stderr: re-run the Step 2 `--inspect` command with
  `JF_AGENT_GUARD_LOG_LEVEL=debug` exported and read the single eligibility
  record it prints. Never paste an access token from that output.
- **Configured server missing from the harness's list or Verify** —
  rejected/pending. Re-run the enable/verify step (Install → Step 4a).
- **MCP still appears as approved (or won't go away) after editing the config**
  — on harnesses that pre-approve via files (e.g. Claude Code), approval state
  lives in plain JSON arrays read at session start (nothing cached, so `npm
  cache clean` is unrelated). Check that harness's approval-precedence list in
  [harness-common.md](harness-common.md) and remove the entry from every file
  that lists it, then restart. On UI-toggle harnesses (Cursor, VS Code) there is
  no such file — disable/stop the server in the harness's MCP view instead.
- **Agent Guard: `multiple/no JFrog server configured`** (the agent guard
  cannot pick a JFrog server) — pass `--server <ID>` (after `jf c add <ID>`) OR
  export both `JFROG_URL` and `JFROG_ACCESS_TOKEN` in the launching shell, then
  restart the agent.
- **`Server ID '<id>' does not exist.`** — `--server` is not a configured jf
  CLI server. Re-resolve the id (Pre-flight) or `jf c add`, then retry. Not a
  catalog miss and not package-unreachable.
- **`--project flag is required` / `--mcp flag is required`** — empty or
  omitted flag; fill from Pre-flight / the MCP name and retry.
- **OAuth MCP failing** — refresh token expired; re-run the OAuth login step.
- **401/403 with `${VAR}`** — env var unset/wrong; re-export in the launching
  shell and restart the agent.
- **Network / proxy / DNS error** — outside the agent guard's scope; tell the
  user and stop. This is package-unreachable per
  [Classify npx @jfrog/agent-guard failures](#classify-npx-jfrogagent-guard-failures)
  — never install the MCP by any other means as a workaround. Before stopping,
  though: in a Cursor sandbox agent a `403` on a JFrog host is the sandbox
  allowlist and has a concrete fix — see the "403 … in a Cursor sandbox agent"
  entry below.
- **npx package fetch returns 403 or 404** — usually a corporate proxy/VPN, a
  blocked or wrong registry, the JFrog registry being unreachable, or a
  curation policy — not a missing package. The default
  `<REGISTRY_URL>` (`https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/`)
  is JFrog's publicly accessible Releases Artifactory instance: anonymous
  access, hosts Agent Guard releases. Confirm `--registry <REGISTRY_URL>`
  resolves (and, if using a private override via `JFROG_AGENT_GUARD_REPO`, that
  the access token is valid for that repo). Same hard-stop rule applies: do
  not fall back to the usual MCP install routes that skip the approved catalog
  and Agent Guard as the MCP proxy.
- **403 (or a Step 0 network failure) in a Cursor sandbox agent (Agents
  Window)** — Cursor's network allowlist. Retry once with
  `required_permissions: ["full_network"]`; if it still 403s, has no effect, or
  the param isn't on the Shell tool, create `~/.cursor/sandbox.json` (or the
  project `.cursor/sandbox.json`) per the "Sandbox network allowlist" section in
  [harness-cursor.md](harness-cursor.md). Do NOT keep retrying `full_network`
  or punt to a manual/out-of-sandbox run.
