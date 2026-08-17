# Resolving an ambiguous server-id — the picker

**Required behavior whenever any detector that takes `[server-id]`
exits `ask` (`status: "ask"`) with a `candidates` list of server IDs
— not optional background.** This is shared, unmodified, across every
step in "Resolving `<server-id>` for Steps 4-7" in `SKILL.md`: Step 4
(`jfrog-detect-server-ping.mjs`), Step 5's placeholder substitution
(`jfrog-detect-jfrog-mcp.mjs`), Step 6 (`jfrog-detect-project.mjs`,
distinguished by `"unresolved": "server"` — see
`references/project-picker.md`), and Step 7
(`jfrog-detect-catalog-runtime.mjs`). All of them resolve a server-id
through the same shared code (`scripts/jfrog-resolve-jf-server.mjs`),
so `candidates` is always the same shape: a plain array of configured
server-id strings, e.g. `["prod", "staging"]`.

This can only happen when **2 or more** servers are configured with
none marked `isDefault` — ambiguity by definition requires at least
two candidates, so unlike the project picker there is no "fewer than
2" plain-text fallback case here.

**All of the above — `unresolved`, `candidates`, which step/detector
triggered this — is reasoning for you to follow silently, never to
narrate.** The user never sees why they're being asked, only the
`AskUserQuestion` payload itself.

Call `AskUserQuestion` with the **first two** entries of `candidates`
(in the order the detector returned them — never reordered, never
chosen by matching a hostname, git identity, or any other signal) as
the two options, and rely on the tool's built-in "Other" for typing a
different server-id:

```json
{
  "questions": [
    {
      "question": "Which JFrog server do you want to use?",
      "header": "Server",
      "multiSelect": false,
      "options": [
        {"label": "<candidates[0]>", "description": "Server ID: <candidates[0]>"},
        {"label": "<candidates[1]>", "description": "Server ID: <candidates[1]>"}
      ]
    }
  ]
}
```

**Never surface the full candidate list or a count** to the user in
any case — the picker's two options (plus "Other") are the entire
user-facing surface, same rule as the project picker.

On picking option 1 or 2, or typing a value via **Other** → re-invoke
**the same detector that emitted the ask** (never a different one)
with the picked/typed server-id as the positional argument that step
expects (see that step's own usage line in `SKILL.md`). Never invent a
server-id, never rely on `jf`'s own default-resolution fallback — the
whole point of asking is that this skill's own resolution order
(explicit arg → `JF_SERVER_ID` → `isDefault` → sole server) already
came up empty.
