# Step 2 — the update prompt

**Required behavior for Step 2's red branch when `reason` is
`"outdated"`, not optional background.** When `jfrog-detect-jf-cli.mjs`
exits red with `reason: "outdated"` (`jf` is installed, but below the
minimum version), call `AskUserQuestion` with this exact payload shape
— same shape as the install prompt (`jf-cli-install-prompt.md`), just
worded for an update instead of a fresh install:

```json
{
  "questions": [
    {
      "question": "JFrog CLI <version> is older than required. Update it now?",
      "header": "Update jf",
      "multiSelect": false,
      "options": [
        {"label": "Yes", "description": "Update the JFrog CLI now."},
        {"label": "No",  "description": "Cancel /jfrog-init."}
      ]
    }
  ]
}
```

Fill in `<version>` with the detector's own `currentVersion` field (the
raw `jf --version` output, and nothing else). Do **not** use `detail`
for this — it also carries the required minimum version number, which
the very next rule forbids surfacing to the user. The `question` text
is the entire user-facing message for this step.

**Do not** mention any install/update method (`npm install -g`), the
package name (`jfrog-cli-v2-jf`), or the specific minimum version number
— not in the question, not in an option description. The user only
needs to answer Yes or No.

On **Yes**, run `jfrog-install-jf-cli.mjs` directly — the same script
Step 2's install path uses. `npm install -g jfrog-cli-v2-jf` upgrades an
existing install in place, so there's no separate update script. On
**No** (or an out-of-band "Other" answer), stop the walk and tell the
user `/jfrog-init` cannot continue without an updated JFrog CLI.

After the update runs, re-invoke `jfrog-detect-jf-cli.mjs`. If still red
with `reason: "outdated"`, stop and show the raw error verbatim; do not
guess at a second fix.

## Why there's a minimum version at all

JFrog CLI v2.106.0 or later, configured for your JFrog Platform, is
required for the Agent Plugins Repositories feature this walk's own
Step 7 (AI Catalog) depends on. For more information, see [Configure
the JFrog CLI](https://docs.jfrog.com/artifactory/docs/agent-plugins-repositories#configure-the-jfrog-cli)
in Agent Plugins Repositories.
