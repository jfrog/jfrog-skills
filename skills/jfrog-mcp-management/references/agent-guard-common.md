# Agent guard common — registry URL & pre-flight

Reference for the Install and List flows of the `jfrog-mcp-management` skill.
Read this before running any
`npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard` command
(`--list-available`, `--inspect`, `--login`).

Terminology used throughout these skills:

- **project (workspace)** — the current working directory (CWD) where the agent
  is running. Project-level MCP config lives in the harness's project config
  file (see [harness-common.md](harness-common.md); e.g. `.mcp.json` for Claude
  Code).
- **JFrog project key** (`<JFROG_PROJECT_KEY>`) — the key identifying a JFrog
  project (the AI Governance project). This is distinct from the workspace/CWD.

## Registry URL

Wherever `<REGISTRY_URL>` appears, substitute the value of the
`JFROG_AGENT_GUARD_REPO` environment variable if it is set. Read it with
`node -p "process.env.JFROG_AGENT_GUARD_REPO || ''"` (empty output means
unset). Otherwise use
`https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/` — JFrog's
publicly accessible Releases Artifactory instance. It allows anonymous access
and hosts Agent Guard releases. It is independent of the AI Governance server:
the two can be the same host or different ones, and neither is derived from
the other.

Canonical invocation (every catalog / login command; never omit `--registry`):
`npx --yes --registry "<REGISTRY_URL>" @jfrog/agent-guard`

`@jfrog/agent-guard` is not published to the public npm registry; resolve it
with `--registry <REGISTRY_URL>` above rather than the default npm registry.

## Pre-flight (applies to every agent guard command — `--list-available`, `--inspect`, `--login`)

Every Agent Guard command and every MCP entry this skill writes targets the AI
Governance server and the AI Governance project (the JFrog project key). Get
both once, before the first command:

```bash
node "<skill_path>/scripts/jfrog-ai-governance-config.mjs" get
```

`<SERVER_ID>` is the AI Governance server ID that `get` returned (`serverId`),
and `<JFROG_PROJECT_KEY>` is its project key (`project`). Then act on `status`:

- `ok` — continue with `<SERVER_ID>` and `<JFROG_PROJECT_KEY>`.
- `no_project` — the server is set, the project is not (e.g. the user told
  `/jfrog-init` they don't use AI Catalog). Ask: "Which AI Governance project
  on `<host>` should I use? I need its project key." (`<host>` is the host
  of the `jpdUrl` that `get` returned.) The answer is `<JFROG_PROJECT_KEY>`
  from now on. Save it by running
  `node "<skill_path>/scripts/jfrog-ai-governance-config.mjs" set "<SERVER_ID>" "<JFROG_PROJECT_KEY>"`.
  NEVER guess, NEVER assume `default`, NEVER invent JFrog project keys, and
  never take one from `JF_PROJECT` or existing MCP entries. There is no
  platform-wide / project-less mode: never offer a "no project" /
  "platform-wide" / "skip" option. If this save command rejects the key,
  ask once more; if that key is rejected too, show the error and stop.
  Never fall back to a project-less call.
- `ambiguous` — several servers are saved (e.g. set up for more than one JFrog
  platform) and none is marked as the AI Governance server. Run
  `node "<skill_path>/scripts/jfrog-ai-governance-config.mjs" list`, show the
  user each `serverId` with its `jpdUrl`, ask: "Which of these is your AI
  Governance server?", save the answer with
  `node "<skill_path>/scripts/jfrog-ai-governance-config.mjs" set "<SERVER_ID>"`,
  then run `get` again.
- `missing` — AI Governance was never set up on this machine; `corrupt` —
  `setup.json` can't be read. Ask the user to run `/jfrog-init` to set it up.
- If a `jfrog-ai-governance-config.mjs set` command above fails for any
  reason other than a rejected project key, show its error and ask the user
  to run `/jfrog-init` to repair the AI Governance setup.

Pass `--server "<SERVER_ID>"` to every Agent Guard command and write it into
every MCP entry; the entry's `_JF_ARGS` carries `project=<JFROG_PROJECT_KEY>`.
Why always: without `--server`, Agent Guard picks a server itself, which
can be a different JFrog platform than the AI Governance server. Existing
MCP entries written by
older versions may lack `--server` or name another server; never copy their
value.

When the user names another JFrog server or project, say: "Your AI Governance
server is `<SERVER_ID>` with project `<JFROG_PROJECT_KEY>`. To change it, run
`/jfrog-init`." If they want to change it, stop; the AI Governance server and
project are chosen in `/jfrog-init`, so they run that first.

- **Live execution is MANDATORY — context reuse is FORBIDDEN.** Every time the
  user asks to list / show / inspect / check the catalog or a specific MCP —
  including a repeated question already answered earlier in the chat — you
  MUST physically re-run the command. NEVER reuse, copy, or re-display output
  from previous turns or context history; the catalog, headers, and required
  inputs change between prompts. (Applies to `--list-available` and
  `--inspect` only — NOT `--login`, which would re-open the OAuth browser, and
  NOT reading local config for *installed* state.)
- The commands need network access to the npm registry and the JFrog
  platform. Grant the matching runtime permission (see
  [runtime-permissions.md](runtime-permissions.md)); a corporate proxy, VPN, or
  blocked registry can also surface as `Forbidden` / `403` errors.

If either value is still unknown, STOP — do NOT run the command with guesses.
