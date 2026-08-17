# Server Login Flow

Add or authenticate a JFrog Platform server. Agent drives flow — user interacts via browser.

Requires Artifactory 7.64.0+ and JFrog CLI (`jf`).

## Security rules

- Never print, echo, or display access tokens in terminal output or chat.
- Confirm auth: "authenticated as user X" — never show the token.
- `jf config` = sole credential store. Never store tokens in files, env var
  profiles, or project directories.
- Validate URLs with ping endpoint before shell use.

## Resolve the active environment

```bash
jf config show 2>/dev/null
```

- **Command errors** (nonzero exit / config unreadable) — stop and report; do **not** treat empty output as 0 servers.
- **0 servers** (success, empty) — ask user for JFrog Platform URL → Web Login.
- **1 server** — use it: `jf config use <server-id>`, done.
- **2+ servers** — user named specific server → use it. Else current default.
  No default → list server IDs/URLs, ask user. **Never iterate servers or
  fallback on error** — see SKILL.md **Server selection rules**.

## Web login (preferred)

### 1. Verify server and register session

```bash
bash <skill_path>/scripts/jfrog-login-register-session.sh "https://mycompany.jfrog.io"
```

Pings server, generates session UUID, registers with Access API. On success:

```
SESSION_UUID=<uuid>
VERIFY_CODE=<last 4 chars>
```

Exit codes: 0 = success, 2 = server unreachable, 3 = registration failed.

### 2. Open the login link and show the verification code

Build login URL:

```
${JFROG_PLATFORM_URL}/ui/login?jfClientSession=${SESSION_UUID}&jfClientName=JFrog-Skills&jfClientCode=1
```

Open it in the user's default browser automatically — don't just print
the link and ask them to click it. OS-appropriate opener:

```bash
open "<login-url>"          # macOS
xdg-open "<login-url>"      # Linux
start "" "<login-url>"      # Windows (cmd) / `Start-Process "<login-url>"` in PowerShell
```

Opener fails or unavailable (headless/remote, no `$DISPLAY`) → fall back
to showing the link as text; not a hard failure.

Show verification code prominently, then confirm the link was opened
(or provide it, on fallback):

> ## Verification code: `<last 4 chars of SESSION_UUID>`
>
> I've opened the login page in your browser — enter the code above.
>
> Let me know when you're done.

Wait for user confirmation. Do not poll automatically.

### 3. Retrieve token, save credentials, verify

```bash
bash <skill_path>/scripts/jfrog-login-save-credentials.sh \
  "https://mycompany.jfrog.io" \
  "<SESSION_UUID from step 1>"
```

Substitute literal platform URL and session UUID from step 1 output.

Retrieves one-time token, derives server ID from URL, saves via `jf config add`,
verifies with Artifactory version check. Leaves default `jf` server unchanged —
pass `--server-id=<id>` on subsequent calls (SKILL.md "Server selection rules").
On success:

```
SERVER_ID=<derived-id>
--- Verifying authentication ---
{ "version" : "7.x.x", ... }
```

Exit codes: 0 = success, 2 = token retrieval failed (user may not have
completed browser login — HTTP 400), 3 = empty token, 4 = config save or
verification failed. The token is one-time-use — see Gotchas below.

## Post-login handoff (mandatory gate)

Before any other JFrog operation against the new server, ask the user:

> Logged in to `<SERVER_ID>`. Do you want to make it the default `jf`
> server? (If you say no, I'll keep using `--server-id=<SERVER_ID>`
> explicitly for follow-up calls.)

- Confirm → `jf config use <SERVER_ID>`, then resume the original task.
- Decline or no answer → keep `--server-id=<SERVER_ID>` on every `jf` call.

## Fallback: manual token setup

Web login fails (old server, network restrictions):

1. Ask user to generate token in JFrog UI:
  **Administration > Identity and Access > Access Tokens > Generate Token**
2. Save non-interactively:

```bash
jf config add <server-id> \
  --url=https://<jfrog-url> \
  --access-token=<token> \
  --interactive=false
```

## Gotchas

- Token endpoint (`/token/{uuid}`) **one-time-use**. Consumed (even failed save)
  → session UUID invalidated → restart step 1. save-credentials script handles
  cleanup; non-zero exit after token consumed → restart step 1.
- Server ID from hostname: `https://mycompany.jfrog.io` → `mycompany`.
  Self-hosted slugified: `https://artifactory.internal.corp` → `artifactory-internal-corp`.
- `**jf**`, `**uuidgen**` (register-session), and `**jq**` (save-credentials) must be on PATH.
