# How to ask the user questions

When the skill needs a Yes/No answer, a selection, or any other input
from the user, use the **native interactive prompt tool** built into
your harness so the user can click or select rather than type:

| Harness     | Preferred tool         |
|-------------|------------------------|
| Claude Code | `AskUserQuestion`      |
| Codex       | `request_user_input`   |

Each reference file specifies the question text and option labels; use
your harness's native tool to present them. Native prompt tools already
offer a free-text "Other" fallback for values not in the list — don't
add a duplicate "Other" option yourself.

**Fallback**: if no native prompt tool is available, or the tool
returns without a selection, surface the question as plain text in
your reply — never silently stop without presenting it.
