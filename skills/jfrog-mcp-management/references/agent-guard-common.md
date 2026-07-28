# Agent guard common — registry URL & pre-flight

Reference for the Install and List flows of the `jfrog-mcp-management` skill.
Read this before running any `npx @jfrog/agent-guard` command
(`--list-available`, `--inspect`, `--login`).

Terminology used throughout these skills:

- **project (workspace)** — the current working directory (CWD) where the agent
  is running. Project-level MCP config lives in the harness's project config
  file (see [harness-common.md](harness-common.md); e.g. `.mcp.json` for Claude
  Code).
- **JFrog project key** (`<JFROG_PROJECT_KEY>`) — the key identifying a JFrog
  project. This is distinct from the workspace/CWD.

## Registry URL

Wherever `<REGISTRY_URL>` appears, substitute the value of the
`JFROG_AGENT_GUARD_REPO` environment variable if it is set. Otherwise use
`https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/`.

## Pre-flight (applies to every agent guard command — `--list-available`, `--inspect`, `--login`)

- **Live execution is MANDATORY — context reuse is FORBIDDEN.** Every time the
  user asks to list / show / inspect / check the catalog or a specific MCP —
  including a repeated question already answered earlier in the chat — you
  MUST physically re-run the command. NEVER reuse, copy, or re-display output
  from previous turns or context history; the catalog, headers, and required
  inputs change between prompts. (Applies to `--list-available` and
  `--inspect` only — NOT `--login`, which would re-open the OAuth browser, and
  NOT reading local config for *installed* state.)

- **`<JFROG_PROJECT_KEY>` is always mandatory.** Resolve via the project
  chain: existing Agent Guard MCP entries (any harness config file per
  [harness-common.md](harness-common.md); `_JF_ARGS` → `project=`) →
  `JF_PROJECT` env var → ASK the user. If none resolves, STOP and ask — NEVER
  guess, NEVER assume `default`, NEVER invent JFrog project keys.

- **`<SERVER_ID>` is auto-resolvable.** This extends the base skill's
  [server selection rules](../../jfrog/SKILL.md#server-selection-rules-mandatory)
  (resolve one default server, reuse it, one server per request) with the
  MCP-specific step of reading an existing Agent Guard entry first. Resolve in
  order, stop at the first match:
  1. An existing Agent Guard MCP entry's `--server <ID>` (project or user
     config, per [harness-common.md](harness-common.md)) — reuse it.
  2. `JFROG_URL` + `JFROG_ACCESS_TOKEN` set in the env (the Step 0 check and the
     agent guard also accept the legacy `JF_URL` + `JF_ACCESS_TOKEN` pair as a
     fallback) — use them and do NOT pass `--server` (the agent guard reads the
     env directly).
  3. List configured servers with the jf CLI — run `jf config show
     --format=json` (do NOT parse `~/.jfrog/jfrog-cli.conf.v6` yourself; the
     CLI masks tokens, so its output is safe to read). Exactly one → use it;
     two or more → use the one with `"isDefault": true`; if none is marked
     default → ASK the user which one. Then pass `--server <ID>`.
  4. None of the above → ask the user to run `jf c add <ID>` or export
     `JFROG_URL` + `JFROG_ACCESS_TOKEN` (or the legacy `JF_URL` +
     `JF_ACCESS_TOKEN`), then retry.

  When the ID came from an existing Agent Guard MCP entry or jf config, always
  pass it as `--server <ID>`; only on the `JFROG_URL`+token env path, never pass
  `--server`.

  > Note: the agent uses `jf config show --format=json` here only to *discover a
  > server ID* — a token is not needed, so the masked output is fine. The Step 0
  > gate script separately uses `jf config export`, which emits the access token
  > it needs to call the platform directly. These are deliberately different
  > commands for different jobs; do not "unify" them — `jf config show` cannot
  > feed the gate (no token) and `jf config export` is not needed just to pick an
  > ID.
- The commands need network access to the npm registry and the JFrog
  platform. Grant the matching runtime permission (see
  [runtime-permissions.md](runtime-permissions.md)); a corporate proxy, VPN, or
  blocked registry can also surface as `Forbidden` / `403` errors.

Once both are determined, proceed. If either is still unknown, STOP — do NOT
run the command with guesses.
