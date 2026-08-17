# Step 6 — picking a project interactively

**This is not optional background reading — it's part of Step 6's
required behavior.** Read this in full before handling any Step 6
result other than a clean green on the first try (no input needed, or
the typed input needs a picker). Use the exact `AskUserQuestion`
payload shapes below; do not paraphrase or invent your own wording.

**Everything below — `unresolved`, `candidatesWithNames`,
`similarProjects`, and which bullet you land on — is reasoning for you
to follow silently, never to narrate.** The user never sees why a
particular branch was taken, only the resulting prompt (the
`AskUserQuestion` payload or the plain-text fallback line).

**Check `unresolved` before anything below.** If the JSON has
`"unresolved": "server"`, this is NOT a project ask — the server-id
itself is ambiguous (multiple jf servers configured, none marked
`isDefault`). This can happen even when re-invoking Step 6 on its own
(e.g. a later "switch project" request), not just on a fresh full
walk. Do not fall through to the project picker below; instead **stop
and read `references/server-picker.md` in full** for the exact
`AskUserQuestion` payload, then re-invoke Step 6 with the picked
server-id as arg 1 (project input, if any, stays arg 2).

Whenever the detector needs the user to choose — no input was passed,
the typed input didn't match anything (404), or it matched more than
one project (ambiguous) — it emits `candidatesWithNames` (the full
enumerated list, `{key, displayName}`, sorted by key) alongside the
red/ask result, as long as enumeration succeeded. Use it to drive an
`AskUserQuestion` picker instead of asking the user to type a key or
name from memory. A confirmed 404 additionally carries
`similarProjects` — up to 2 "did you mean...?" near-misses of the
typed input (see `scripts/lib/projects.mjs`) — which take priority
over the generic first-two when present:

- **404 with `similarProjects` present** → the typed input was close
  to one or two real projects (e.g. typed `widgets20`, JPD has
  `widgets2`/`widgets`). Call `AskUserQuestion`, naming what was typed and
  offering the suggestions plus "Other":

  ```json
  {
    "questions": [
      {
        "question": "There's no project \"<user-input>\" — did you mean one of these?",
        "header": "Project",
        "multiSelect": false,
        "options": [
          {"label": "<similarProjects[0].displayName>", "description": "Project key: <similarProjects[0].key>"},
          {"label": "<similarProjects[1].displayName>", "description": "Project key: <similarProjects[1].key>"}
        ]
      }
    ]
  }
  ```

  If `similarProjects` has only 1 entry, use it as option 1 and fill
  option 2 from the first entry of `candidatesWithNames` that isn't
  already used (`AskUserQuestion` requires 2 options minimum). If no
  such second entry exists (the JPD has exactly this one project), skip
  `AskUserQuestion` entirely and use the plain-text fallback below
  instead. On picking a suggestion → re-invoke the detector with that
  project's **key** as arg 2. On **Other** → the user types a
  different name-or-key; re-invoke with their typed value as arg 2.

- **Otherwise, if `candidatesWithNames` has 2 or more entries** — no
  input was passed, the input was ambiguous, or it was a 404 with no
  close-enough `similarProjects` — call `AskUserQuestion` with the
  **first two** entries of `candidatesWithNames` (in the order the
  detector returned them — never reordered, never chosen by matching
  the user's name, git identity, hostname, or any other signal) as the
  two options, and rely on the tool's built-in "Other" for typing a
  different project:

  ```json
  {
    "questions": [
      {
        "question": "Which project do you want to use?",
        "header": "Project",
        "multiSelect": false,
        "options": [
          {"label": "<candidatesWithNames[0].displayName>", "description": "Project key: <candidatesWithNames[0].key>"},
          {"label": "<candidatesWithNames[1].displayName>", "description": "Project key: <candidatesWithNames[1].key>"}
        ]
      }
    ]
  }
  ```

  On picking option 1 or 2 → re-invoke the detector with that
  project's **key** as arg 2. On **Other** → the user types a
  name-or-key; re-invoke the detector with their typed value as arg 2.

- **If `candidatesWithNames` has fewer than 2 entries** (enumeration
  unavailable, or the JPD genuinely has 0–1 projects) → fall back to a
  single plain-text line, no `AskUserQuestion`:

  > *Which project do you want to use?*

  Nothing before, nothing after. Do NOT append any hint about the
  accepted input format (no *"(name or key)"*, no *"you can type a key
  or name"*, no *"either the display name or key works"*).

- **Never surface the full candidate list or a count** to the user in
  any case — the picker's two options (plus "Other") or the plain-text
  fallback are the entire user-facing surface.

Once the user picks or types a value, re-invoke the detector with it
as arg 2:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-project.mjs" "<server-id>" "<user-input>"; rc=$?; true
```

**Do NOT** `export JF_PROJECT=…`. The only state write is the one
SKILL.md's Final summary mandates (`jfrog-state-file.mjs set`), or
`jfrog-detect-all.mjs`'s own write when running the batch walk.
