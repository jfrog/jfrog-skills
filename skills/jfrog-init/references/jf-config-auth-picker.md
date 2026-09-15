# jf config: web login vs. access token

**Required behavior wherever this file is the referenced fix, not
optional background.** Two distinct call sites land here, with two
different option sets:

- **Step 3** (`jf` is installed but not connected to any server at
  all) — full picker: **Web login or Access token**.
- **Step 4**, when sub-check (1) (reachability) passed but sub-check
  (2) (`jf rt ping`) failed with an auth-shaped error — `jf` is
  already connected to a server, its token is just stale. **Token
  only** (see "Why Step 4 is token-only" below) — skip straight to
  that section.

## Step 3: ask web vs. token

```json
{
  "questions": [
    {
      "question": "How do you want to connect to your JFrog Platform?",
      "header": "Connect",
      "multiSelect": false,
      "options": [
        {"label": "Web login", "description": "Opens in your browser. I'll drive the rest."},
        {"label": "Access token", "description": "You paste a token into one command you run yourself."}
      ]
    }
  ]
}
```

If the URL isn't already known, ask for it in a plain chat message
first (*"What's your JFrog Platform URL?"*) — both branches need it.
**Plain chat message, not `AskUserQuestion` with suggested options** —
there is no real candidate to offer here (unlike the server/project
pickers, which choose among *actual configured* values), so a picker
would only ever be guessing. Never suggest, guess, or pre-fill a
specific JFrog Platform URL (e.g. `mycompany.jfrog.io`, or anything else
inferred from the user's email domain, org, or prior context) — wait
for the user to type their own.

### Web login branch

This skill carries its own local copies of the web-login scripts under
`scripts/` — nothing is invoked cross-skill from the base `jfrog` skill.
The token never passes through this conversation.

1. **Register the session:**
   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/jfrog-login-register-session.mjs" "<url>"
   ```
   Both login scripts are pure Node — unlike Step 2's `jf` CLI itself,
   there's no separate prerequisite probe needed here (no `uuidgen`/`jq`
   dependency to check for). Exit 2 = server unreachable, exit 3 =
   registration failed — either one is a **red**, same as any other Step
   3/4 red: show the raw error, stop.
2. **Build the login URL** from `SESSION_UUID`:
   ```
   <url>/ui/login?jfClientSession=<SESSION_UUID>&jfClientName=JFrog-Skills&jfClientCode=1
   ```
   **Open it in the user's default browser automatically — do not just
   print the link and ask them to click it themselves.** Use the
   OS-appropriate opener:
   ```bash
   open "<login-url>"          # macOS
   xdg-open "<login-url>"      # Linux
   start "" "<login-url>"      # Windows (cmd) / `Start-Process "<login-url>"` in PowerShell
   ```
   If the opener command fails or isn't available (headless/remote
   session, no `$DISPLAY`, etc.), fall back to showing the link as text
   so the user can open it manually — don't treat that as a hard
   failure. This mirrors the base `jfrog` skill's own
   `references/jfrog-login-flow.md` step 2 exactly; it's spelled out
   again here, in full, rather than left as a cross-reference, because a
   model following only this file (never opening the base skill's doc)
   must still open the browser automatically, not silently fall back to
   printing the link.

   Show the verification code prominently, then confirm the link was
   opened (or provide it, on fallback):

   > ## Verification code: `<last 4 chars of SESSION_UUID>`
   >
   > I've opened the login page in your browser — enter the code above.
   >
   > Let me know when you're done.

   Then `AskUserQuestion`:
   ```json
   {
     "questions": [
       {
         "question": "Did you finish logging in?",
         "header": "Continue",
         "multiSelect": false,
         "options": [
           {"label": "Yes, continue",           "description": "Retrieve credentials and continue the walk."},
           {"label": "No, cancel /jfrog-init", "description": "Stop the walk cleanly."}
         ]
       }
     ]
   }
   ```
3. On **Yes**, retrieve and save credentials:
   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/jfrog-login-save-credentials.mjs" "<url>" "<SESSION_UUID>"
   ```
   Exit 0 → done; the only thing this prints is `SERVER_ID=<id>` and an
   Artifactory version check — the token itself never appears in this
   script's output, and this skill never reads it. Exit 2/3/4 → the
   session's one-time token is now consumed either way (see the base
   skill's "Gotchas") — tell the user plainly it didn't work and offer
   to either restart web login from step 1 above or switch to the
   Token branch; don't retry silently.
4. Re-run whichever detector sent you here (`jfrog-detect-jf-config.mjs`
   for Step 3) to confirm green, then continue.

Skip the base skill's "make it the default `jf` server?" gate — this
skill's own server resolution (`references/server-picker.md` /
"Resolving `<server-id>`" in `SKILL.md`) already uses the sole
configured server silently when there's only one, so that question
would be redundant here.

### Token branch (Step 3, and the only option for Step 4)

Print exactly one ready-to-run command, with `--url` (and, for Step 4,
the already-resolved `--server-id`) filled in — the user runs it
**themselves, in their own terminal**, replacing the placeholder with
their own token. **Never** ask for the token in chat, and never run
this command yourself via the Bash tool — the token must not enter
this conversation at all.

- **Step 3** (no server-id yet — one will be created):
  ```
  jf config add jfrog --url=<url> --access-token=<paste-your-token-here> --interactive=false
  ```
- **Step 4** (existing server, refreshing a stale token — reuse the
  already-resolved `<server-id>` and `--overwrite` so this updates the
  same entry instead of creating a second one):
  ```
  jf config add <server-id> --url=<url> --access-token=<paste-your-token-here> --interactive=false --overwrite
  ```

Send this as its own chat message (same rule as today: no `!` prefix —
that runs inside Claude Code's own shell). Then `AskUserQuestion`:

```json
{
  "questions": [
    {
      "question": "Did you finish running that command?",
      "header": "Continue",
      "multiSelect": false,
      "options": [
        {"label": "Yes, continue",           "description": "Re-check and continue the walk."},
        {"label": "No, cancel /jfrog-init", "description": "Stop the walk cleanly."}
      ]
    }
  ]
}
```

On **Yes** → re-run the same detector that sent you here
(`jfrog-detect-jf-config.mjs` for Step 3, `jfrog-detect-server-ping.mjs
[server-id]` for Step 4 — never the other one). If still red, print
the same command and the same `AskUserQuestion` again — the loop is
harmless. On **No** → stop with exactly one sentence: *"OK — run
`/jfrog-init` again when ready."* Nothing else.

## Why Step 4 is token-only

`jfrog-login-save-credentials.mjs` derives (or overwrites) a server
entry **from the URL itself** (`https://mycompany.jfrog.io` →
`mycompany`), independent of whatever server-id Step 4 actually
resolved. Running the web-login branch there could silently create a
*second*, differently-named server instead of refreshing the token on
the one Step 4 is checking — so Step 4 only ever offers the Token
branch above, which explicitly reuses the existing `--server-id`.

## Step 4's full branch table

`jfrog-detect-server-ping.mjs [server-id]` runs two sub-checks, both
must pass: (1) an anonymous `fetch` of `<url>/artifactory/api/system/ping`
— HTTP `200/401/403` = up, `404`/connection failure/`5xx` = red; (2)
`jf rt ping --server-id=<id>`, token kept inside `jf`'s process — a
pass means the token is valid and authorized, the earliest signal of a
stale credential before it fails later at runtime. Sub-check (1) green
+ (2) red = tailor the message: an auth-shaped error points at a stale
token (the token-only fix above); a 30s timeout points at network/VPN;
anything else shows the raw `jf rt ping` error without guessing a cause.

- **Exit 0 (green)** → proceed to Step 5.
- **Exit 1 (red)** → branch on the detector's `detail`, don't just stop
  and dead-end on a generic "check with your admin":
  - **Credentials invalid/expired** (sub-check (1) passed, only the
    token is stale) → use the token-only fix above, then re-run *this
    step's* detector (`jfrog-detect-server-ping.mjs`, not Step 3's) —
    the user already has `jf` connected, they just need a fresh token.
  - **Anything else** (connection failed, timeout, unexpected HTTP
    code, reachability itself failed) → **stop.** No fix script. Show
    the raw error line verbatim and tell the user to fix that and
    re-run `/jfrog-init`.
- **Exit 2 (ask)** → multiple servers configured, none marked
  `isDefault`, no server-id passed. **Stop and read
  `references/server-picker.md` in full**, then re-invoke with the
  pick as either the positional argument or `JF_SERVER_ID`.

## What the token flow never does

Neither this file's Token branch nor the Web branch's scripts ever
print, log, or store a token where this skill (or the model) can read
it: the Token branch's command is run by the user in their own
terminal; the Web branch's `jfrog-login-save-credentials.mjs` keeps the
retrieved token inside its own process and only ever prints
`SERVER_ID=...` plus a version check. `jfrog-detect-jf-config.mjs` only
checks *that* a server is configured (masked `jf config show` output);
`jfrog-detect-server-ping.mjs` validates the token via `jf rt ping`,
keeping it inside `jf`'s own process the whole time.
