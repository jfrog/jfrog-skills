# Step 6 — state reuse across walks

**Required behavior at the start of Step 6, not optional background.**
After a successful walk, `jfrog-detect-all.mjs` writes a hint to
`~/.jfrog/setup.json` containing the resolved JFrog server ID, JPD URL,
and canonical project key (as `currentActiveProject` — no timestamp is
stored; it's a pointer to what's active now, not a usage log). On
subsequent walks, before asking the user for a project, the model MUST:

1. Read the state file for the current server ID via
   `node "${CLAUDE_SKILL_DIR}/scripts/jfrog-state-file.mjs" get-current-project <server-id>`
   — stdout is JSON `{"currentActiveProject": "...", "jpdUrl": "..."}`
   (fields omitted if there's no record for this server-id).
2. If `currentActiveProject` is present AND its `jpdUrl` matches the
   URL `jf config show --format=json` reports for this same server-id
   today — after stripping any trailing `/artifactory` or `/ui` suffix
   and trailing slash from that freshly-read URL, the same
   normalization already applied to the stored `jpdUrl` — call
   `AskUserQuestion` with this exact payload shape (substituting the
   real key for `<KEY>`). A raw, un-normalized comparison will treat
   the server as "repointed" and skip the reuse prompt on every walk
   for any JPD whose config URL carries one of those suffixes:

   ```json
   {
     "questions": [
       {
         "question": "Reuse project <KEY> from your last setup?",
         "header": "Project",
         "multiSelect": false,
         "options": [
           {"label": "Yes", "description": "Use <KEY> again."},
           {"label": "No",  "description": "Pick a different project."}
         ]
       }
     ]
   }
   ```

3. On **Yes** → re-invoke the detector with `<currentActiveProject>` as
   arg 2. On **No** → fall through to the picker/free-form ask (see
   `project-picker.md`).
4. If the state file has no entry for this server (or the JPD URL
   drifted), skip the reuse prompt entirely and go straight to the
   picker/free-form ask.

The state file only stores public identifiers — never a token,
password, session, or any other secret, and never a timestamp. Whenever
Steps 1-4 pass, the Final summary's `jfrog-state-file.mjs set` (or
`jfrog-detect-all.mjs` in the batch walk) updates it atomically (temp
file + rename).
