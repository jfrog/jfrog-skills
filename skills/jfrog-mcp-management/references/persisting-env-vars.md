# Persisting environment variables

Read this for **shell-based harnesses** when a Step 3 input needs to be exported
so its value takes effect. How each harness picks up the exported variable:

- **Claude Code** — a `${VAR}` reference in the config.
- **Cursor** — a `${env:VAR}` reference in the config.
- **Devin Desktop** — a `${env:VAR}` reference in the config.
- **Codex** — a variable name listed in the `env_vars` allow-list; Codex forwards
  that named variable's value from the launching shell to the server (e.g. an env
  var like `Authorization`).
- **OpenCode** — a `{env:VAR}` reference in the config `environment` (OpenCode
  also forwards its ambient environment to local MCP servers).

This applies to any secret, or a non-secret you chose to keep out of the config as
a reference. (VS Code does not use shell env for this — it prompts for `inputs`
values and stores them itself; skip this file.)

These references resolve from the shell that launched the agent, so the variable
has to be exported in that shell and persisted across relaunches. Don't rely on
a fixed list of shells/rc files — detect the syntax family and the actual
startup file the running shell uses, and fall back to asking the user whenever
either is ambiguous.

## 1. Determine the syntax family

```bash
echo "$SHELL"
```

`$SHELL` reports the user's default *login* shell, which is not necessarily the
shell that launched the agent (e.g. a bash session started from a zsh login
shell). Prefer detecting the actual running/parent shell when you can (e.g. the
process that started Claude); use `$SHELL` only as a fallback, and **ask the
user** whenever the running shell — or its startup file — can't be determined
unambiguously.

- Basename ends in `sh` (`bash`, `zsh`, `ksh`, `dash`, `ash`, `sh`, ...) or any
  other POSIX-compatible shell → **POSIX family**: `export VAR_NAME="<value>"`.
  This covers virtually every Unix shell except fish, so don't special-case
  bash vs. zsh vs. anything else in this family — the export syntax is
  identical.
- Basename is `fish` → **fish family**: `set -gx VAR_NAME "<value>"`.
- No `$SHELL` (native Windows session, PowerShell/CMD) → **Windows**: for
  **non-secret** values persist with `setx VAR_NAME "<value>"` (sets it for
  future sessions; the current one still needs the in-session equivalent,
  `$env:VAR_NAME` / `set VAR_NAME`). Do **not** use `setx` for secrets — it
  puts the value on the command line (visible in process listings / command
  history). For secret values, direct the user to set it via the Windows
  environment-variable UI (System Properties → Environment Variables) or a
  secret manager, and keep the in-session example session-scoped.
- Anything that doesn't clearly match one of the above → ask the user which
  family applies rather than guessing.

## 2. Find the startup file to persist it in

Start from the family's canonical default, then verify it's actually the file
in play before writing to it:

| Family | Canonical default |
|--------|-------------------|
| POSIX (bash) | `~/.bashrc` (macOS login shells, e.g. Terminal.app, instead read `~/.bash_profile`, which usually sources `~/.bashrc`) |
| POSIX (zsh) | `~/.zshrc` |
| POSIX (other: ksh, dash, ash, sh, ...) | ask the user — these don't have one universal convention |
| fish | `~/.config/fish/config.fish` |
| Windows | persistent user env (`setx`), no file to edit |

- **Verify before writing**, don't assume the default is correct: `test -f
  <candidate> && echo exists`. If it's missing, or a dotfiles manager /
  framework (oh-my-zsh, starship, chezmoi, etc.) is in play — which often
  generates or `source`s rc files from elsewhere — a hardcoded guess can
  silently miss the file the shell actually reads. Ask the user to confirm or
  name the right file rather than writing blind.
- **If in doubt at any point, ask the user directly** which file to edit — do
  not silently pick one from memory of "common" shells.

## Rules

- **Security:** NEVER take secrets in the chat, echo them back, or write raw
  secret values into a config file. For secret values, instruct the user to add
  the line themselves (e.g. via `read -rs VAR_NAME && export VAR_NAME` for the
  current session) — you never see or type the value.
- After exporting, the user must **relaunch the agent** so the exported value
  takes effect — the harness picks it up on next launch (resolving `${VAR}` /
  `${env:VAR}`, or forwarding the `env_vars`-listed variable on Codex).
