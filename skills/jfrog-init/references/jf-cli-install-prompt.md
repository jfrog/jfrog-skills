# Step 2 — the install prompt

**Required behavior for Step 2's red branch, not optional background.**
When `jfrog-detect-jf-cli.mjs` exits red with `reason: "missing"` (`jf`
not found on PATH at all), call `AskUserQuestion` with this exact
payload shape (arrays and options nested correctly; the tool rejects
flat/mis-shaped inputs with `InputValidationError`):

```json
{
  "questions": [
    {
      "question": "JFrog CLI isn't installed. Install it now?",
      "header": "Install jf",
      "multiSelect": false,
      "options": [
        {"label": "Yes", "description": "Install the JFrog CLI now. May add one line to your shell startup file so future terminals can find it."},
        {"label": "No",  "description": "Cancel /jfrog-init."}
      ]
    }
  ]
}
```

When it instead exits red with `reason: "broken"` (`jf` **is** on PATH
but hung, timed out, or failed to run), the "isn't installed" wording
above is false — use this payload instead:

```json
{
  "questions": [
    {
      "question": "JFrog CLI is installed but isn't responding (may be corrupted or hung). Reinstall it now?",
      "header": "Reinstall jf",
      "multiSelect": false,
      "options": [
        {"label": "Yes", "description": "Reinstall the JFrog CLI now. May add one line to your shell startup file so future terminals can find it."},
        {"label": "No",  "description": "Cancel /jfrog-init."}
      ]
    }
  ]
}
```

The user picks with arrow keys. The `question` text is the entire
user-facing message for this step, for either branch.

**Do not** mention any install method (`npm install -g`, the direct
binary download), the package name (`jfrog-cli-v2-jf`), the install
path (`~/.jfrog/bin`), or any other implementation detail — not in the
question, not in an option description, not anywhere. The user only
needs to answer Yes or No; everything else is noise.

Forbidden phrases (non-exhaustive — never surface any of these in the
question or its option descriptions):
- *"via npm"* / *"npm install -g"* / *"as a global Node package"*
- *"download the binary"* / *"from releases.jfrog.io"* / *"to
  ~/.jfrog/bin"*
- *"~68 MB download"* / any size or timing hint

On **Yes**, run `jfrog-install-jf-cli.mjs` directly. On **No** (or the
user selects "Other" and types an out-of-band answer), stop the walk
and tell the user `/jfrog-init` cannot continue without `jf`.

`jfrog-install-jf-cli.mjs` tries npm first (JFrog's own documented
method, retried against the public registry if a private one fails),
then falls back to a checksum-verified direct binary download if npm
itself can't complete the install — and verifies `jf --version`
resolves before reporting success either way. See
`jf-cli-install-internals.md` for exactly how each plan works,
including the one npm trade-off the script can't detect or fix.

After the install runs, re-invoke `jfrog-detect-jf-cli.mjs`. If still
red, stop and show the raw error verbatim; do not guess at a second fix.
