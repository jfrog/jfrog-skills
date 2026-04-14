# Server Login Flow

How to add or authenticate a JFrog Platform server. The agent drives this
flow — the user only interacts via their browser.

Requires Artifactory 7.64.0+ and the JFrog CLI (`jf`).

## Security rules

- Never print, echo, or display access tokens in terminal output or chat.
- When confirming auth status, say "authenticated as user X" — never show
  the token.
- `jf config` is the sole credential store. Never store tokens in files,
  env var profiles, or project directories.
- Validate URLs with the ping endpoint before using them in shell commands.

## Resolve the active environment

```bash
jf config show 2>/dev/null
```

- **0 servers** — ask the user for their JFrog Platform URL, then go to
  Web Login.
- **1 server** — use it: `jf config use <server-id>`, done.
- **2+ servers** — if the user named a specific server, use that one. Otherwise
  use the current default. If no default is set, list server IDs and URLs and
  ask the user which to use. **Never iterate through servers or fall back to
  another server on error** — see SKILL.md **Server selection rules**.

## Web login (preferred)

### 1. Verify server and register session

Run with `required_permissions: ["full_network"]`:

```bash
bash <skill_path>/scripts/jfrog-login-register-session.sh "https://mycompany.jfrog.io"
```

The script pings the server, generates a session UUID, and registers it with
the Access API. On success it outputs:

```
SESSION_UUID=<uuid>
VERIFY_CODE=<last 4 chars>
```

Exit codes: 0 = success, 2 = server unreachable, 3 = registration failed.

### 2. Show the user the verification code and login link

Build the login URL:
```
${JFROG_PLATFORM_URL}/ui/login?jfClientSession=${SESSION_UUID}&jfClientName=JFrog-Skills&jfClientCode=1
```

Show the verification code prominently, then the clickable link:

> ## Verification code: `<last 4 chars of SESSION_UUID>`
>
> Open this link to log in, then enter the code when prompted:
> [Log in to mycompany.jfrog.io](<login URL>)
>
> Let me know when you're done.

Wait for the user to confirm. Do not poll automatically.

### 3. Retrieve token, save credentials, verify

Run with `required_permissions: ["all"]` (the script writes to `~/.jfrog/`
via `jf config add`, which is outside the workspace):

```bash
bash <skill_path>/scripts/jfrog-login-save-credentials.sh \
  "https://mycompany.jfrog.io" \
  "<SESSION_UUID from step 1>"
```

Substitute the literal platform URL and session UUID from step 1 output.

The script retrieves the one-time token, derives a server ID from the URL,
saves credentials via `jf config add`, sets the server as default, and
verifies with an Artifactory version check. On success it outputs:

```
SERVER_ID=<derived-id>
--- Verifying authentication ---
{ "version" : "7.x.x", ... }
```

Exit codes: 0 = success, 2 = token retrieval failed (user may not have
completed browser login — HTTP 400), 3 = empty token, 4 = config save or
verification failed.

**The token endpoint is one-time-use.** If consumed (even in a failed save),
the session UUID is invalidated and the flow must restart from step 1.

## Fallback: manual token setup

If web login fails (server too old, network restrictions):

1. Ask the user to generate a token in the JFrog UI:
   **Administration > Identity and Access > Access Tokens > Generate Token**
2. Save it non-interactively:

```bash
jf config add <server-id> \
  --url=https://<jfrog-url> \
  --access-token=<token> \
  --interactive=false
```

## Gotchas

- The token endpoint (`/token/{uuid}`) is **one-time-use**. If consumed
  (even in a failed save), the session UUID is invalidated and the flow
  must restart from step 1. The save-credentials script handles cleanup,
  but if it exits non-zero after consuming the token, restart from step 1.
- Step 3 requires `required_permissions: ["all"]` because `jf config add`
  writes to `~/.jfrog/` which is outside the workspace. Using only
  `full_network` silently blocks the write.
- Server ID is derived from the hostname: `https://mycompany.jfrog.io`
  becomes `mycompany`. Self-hosted URLs are slugified:
  `https://artifactory.internal.corp` becomes `artifactory-internal-corp`.
- Both scripts require `curl` on PATH. The save-credentials script also
  requires `jf` and `jq`.
