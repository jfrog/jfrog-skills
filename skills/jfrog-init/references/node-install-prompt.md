# Step 1 — the Node.js install prompt

**Required behavior for Step 1's red branch, not optional background.**
When `node --version` is missing, unparseable, or its major version is
`< 18`, call `AskUserQuestion` with this exact payload shape (fill in
`<reason>` with either `isn't installed` or the specific `` `<version>`
is too old (need ≥ 18) ``, matching whichever is actually true):

```json
{
  "questions": [
    {
      "question": "Node.js <reason>. Install it now?",
      "header": "Install Node",
      "multiSelect": false,
      "options": [
        {"label": "Yes", "description": "Install Node.js now. Adds a line to your shell startup file so future terminals can find it."},
        {"label": "No",  "description": "Cancel /jfrog-init."}
      ]
    }
  ]
}
```

**Do not** mention any install method (nvm, winget), a version manager
name, or any URL — not in the question, not in an option description.
The user only needs to answer Yes or No.

On **No** (or an out-of-band "Other" answer), stop the walk and tell
the user `/jfrog-init` cannot continue without Node ≥ 18.

## On Yes: no script — run these commands directly

**Node missing entirely means no `.mjs` script can run to install it**
(same chicken-and-egg reason Step 1 has no detector script at all — see
`SKILL.md`). The install itself is a bash/PowerShell command run
directly via the Bash tool, exactly like Step 1's own `node --version`
check, with the same `; true` treatment described in
`script-invocation.md`.

First, determine the platform:

```bash
uname -s 2>/dev/null || echo Windows_NT
```

**macOS / Linux** (anything other than a Windows-shaped result) — install
a pinned `nvm` release, then install the current Node LTS. The version
below is pinned rather than resolved from `api.github.com/.../latest` —
that endpoint is unauthenticated and rate-limited to 60 requests/hour per
IP, so it routinely 403s behind a corporate NAT; when it fails silently
(redirected to `/dev/null`), the tag resolves to an empty string, the
install-script URL collapses to `nvm-sh/nvm//install.sh`, and without
`-f` that 404 body would get piped straight into `bash`. Bump
`NVM_TAG` here when nvm ships a new release:

```bash
NVM_TAG=v0.40.6 && \
curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_TAG}/install.sh" | bash && \
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && \
nvm install --lts && node --version && npx --version
```

**Windows** — install via `winget` (ships by default on Windows 10
1709+ / Windows 11):

```powershell
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
```

`winget`'s PATH update isn't visible to the current shell. On success,
tell the user to open a new terminal and re-run `/jfrog-init` — do not
try to re-verify `node --version` in the same session on Windows.

## Fallback

Any failure on macOS/Linux (no `curl`, network error, the `nvm`
install script itself failing, or the final `node --version` still not
resolving) — or `winget` missing/failing on Windows — falls back to
today's plain message: tell the user to install Node.js ≥ 18 using
whichever method they prefer, then re-run `/jfrog-init`. Do not retry
automatically and do not try a second install method.
