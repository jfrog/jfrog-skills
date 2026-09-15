# Operating rules: silent walk, exit codes, and flow

## Customer-facing output

**The user does not need to see the checklist you are walking, but does
need to see what actually happened.** Run the detectors silently,
capture their output for your own reasoning, and surface only what the
user needs to know or act on:

- **Do not** narrate step numbers ("Step 1…", "moving to Step 3…")
  while the walk is in progress.
- **Do not** paste detector JSON, exit codes, or shell command output
  into the reply.
- **Do not** narrate the branch-selection reasoning behind an
  `AskUserQuestion` or plain-text prompt — e.g. explaining that
  `unresolved` wasn't `"server"`, or that `candidatesWithNames` had two
  or more entries, so this is "the generic ask using the first two
  candidates." That reasoning (in `server-picker.md`, `project-picker.md`,
  and the other reference docs' branch tables) is written for you to
  follow silently, not to summarize out loud — the field names in it are
  never user-facing. The only output the user sees at an ask point is
  the prompt itself.
- **Do not** narrate whether the `AskUserQuestion` tool is available in
  the current harness before falling back to the plain-text prompt
  (e.g. "the AskUserQuestion tool isn't available here, I'll present
  this as a plain question instead"). If it isn't available, silently
  use the plain-text fallback already documented for that ask point.
- **Do not** announce that you're about to run the checklist, or name
  which check comes first — not even generically ("I'll run the setup
  checklist silently, starting with the JFrog CLI check" is itself a
  violation: it names a step while claiming to be silent). The same
  applies to reading reference docs: "I'll start by reading the flow
  docs" is a preamble. Silently means no preamble message at all — not
  before running commands, not before reading files. Say nothing until
  you have something the user needs to act on (an ask, a failing result)
  or the final summary.

Instead:

- **When everything passes**, give a short recap in the final summary
  (see SKILL.md's "Final summary" section): a short, emoji-based checklist — JF CLI
  & Config, JFrog MCP Plugin, Project & AI Catalog — so the user sees
  the end state of every check at a glance, not raw step numbers and
  not the Node.js check (an implementation detail, not user-facing).
- **When something fails**, say *what's wrong in plain English* and
  *what the user needs to do next*, in one or two sentences. Show the
  exact command they need to run (they must see what they're
  approving).
- **On failure, the raw detector error line is fair game** to include
  verbatim as a debugging aid — one line, without the JSON wrapper.

SKILL.md documents the flow **for you (the model)**, not for the user.

## Invoking scripts: exit codes are signal, not failure

Every detector command shown in SKILL.md signals a failure or an ask via a
non-zero exit code, by design — append `; rc=$?; true` when invoking
any of them. **`rc=$?` is not optional**: every Step's branch table
in SKILL.md keys off the exit code, and a bare `; true` throws it away, so
every failure and ask silently reads as success. **Read
`references/script-invocation.md` in full** before running any command
in this walk — the exact pattern and why it's required, not optional
background.

## Flow

**Follow this flow literally.** Every decision node is covered by a
detector or fix script in SKILL.md; every user-facing prompt uses the exact
wording documented in the corresponding step. Do not reorder, do not
skip, do not narrate the diagram to the user. Read
`references/flow-diagram.md` for the full flowchart before starting a
walk — the same logic as SKILL.md's Steps, drawn as a map.
