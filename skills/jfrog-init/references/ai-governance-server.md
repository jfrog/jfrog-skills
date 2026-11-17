# Step 4 — the AI Governance server and project

**Required behavior for Step 4, not optional background.**

Ask each question below as [how-to-ask-user.md](how-to-ask-user.md)
describes. Use the question and options as written, in the same order,
and only fill in the `<…>` placeholders. The options are the complete
list. There is no recommendation.

`<server-id>` is the `serverId` the ping reported for the jf CLI
default server, and `<jf-host>` is the host of its `jpdUrl`.

`<ai-governance-server-id>` and `<ai-governance-project>` are set only by
the user's answers below (a saved value counts only once the user picks it)
— never taken from environment variables or MCP entries, and never invented.
Ignore an `info:` line about deprecated environment variables from the
script; don't mention it to the user.

## Which server

**Question:** Is your AI Governance server (where your AI Catalog is)
this same JFrog server (`<jf-host>`), or a different one?

**Options:**

1. **`<saved-server-id>`** — Keep the AI Governance server from your last
   setup (`<saved-host>`).
2. **Same server or no AI Catalog** — Use `<jf-host>`. Pick this too if
   you're not sure.
3. **Different server** — Connect another JFrog Platform for AI
   Governance.

Leave out option 1 unless `get` returned a `serverId` other than
`<server-id>`; that `serverId` is `<saved-server-id>`, and `<saved-host>`
is the host of the `jpdUrl` that `get` returned.
When `get` returned `ambiguous`, run `jfrog-ai-governance-config.mjs list`
and offer each saved `serverId` other than `<server-id>` as its own
option 1, with the host of its `jpdUrl` from `list` as `<saved-host>`.

- **`<saved-server-id>`** → `<ai-governance-server-id>` is
  `<saved-server-id>`. Ping it (below). If the ping's `detail` says
  `no url found in jf config`, the server was removed from the jf CLI
  config since: say "`<saved-server-id>` is no longer in your jf CLI
  config." and ask the server question again without that option.
- **Same server or no AI Catalog** → `<ai-governance-server-id>` is
  `<server-id>`.
- **Different server** → ask in a plain chat message, under the same
  rules as Step 3's URL ask in `jf-config-auth-picker.md`: *"Which
  JFrog server is your AI Governance server? Give its server ID from
  your jf CLI config, or its URL."* Match the answer against
  `jf config show --format=json`:
  - A `serverId` there → that server is `<ai-governance-server-id>`.
  - A URL equal to a server's `url` (a trailing `/`, `/artifactory` or
    `/ui` doesn't matter) → that server's `serverId` is
    `<ai-governance-server-id>`. If several servers have that URL, ask
    which one.
  - Either way, if that is the jf CLI default server, continue as
    **Same server or no AI Catalog**; otherwise ping it (below) — it is
    already connected.
  - A URL no server has → connect it with Step 3's web-login-or-token
    picker and branches in `jf-config-auth-picker.md`, with two
    differences:
    - Web login: the `SERVER_ID=` line that
      `jfrog-login-save-credentials.mjs` prints is
      `<ai-governance-server-id>`.
    - Access token: name the server after the start of the URL's host
      (`mycompany` for `https://mycompany.jfrog.io`); that name is
      `<ai-governance-server-id>`. If jf config already has a server
      with that ID, ask the user for another ID. The command is
      `jf config add <ai-governance-server-id> --url=<url> --interactive`.
  - Not a URL and not a `serverId` there → say it isn't in your jf CLI
    config and ask again.

  The jf CLI default server stays as it is. Then ping
  `<ai-governance-server-id>` (below).

Ping the saved or different server with the same detector and branch
table as the jf CLI default server (`jf-config-auth-picker.md`'s
"Step 4's full branch table"):

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-server-ping.mjs" "<ai-governance-server-id>"; rc=$?; true
```

## Which project

The AI Governance project is a project on the AI Governance server
chosen above; `<ai-governance-host>` is the host of the `jpdUrl` that
server's ping reported. Without AI Catalog there is no project.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/jfrog-ai-governance-config.mjs" list; rc=$?; true
```

If the entry whose `serverId` is `<ai-governance-server-id>` has a
`project` (`<KEY>`), ask:

**Question:** Keep `<KEY>` as your AI Governance project on
`<ai-governance-host>`?

**Options:**

1. **Yes** — Use `<KEY>` again.
2. **No** — Pick a different project.

- **Yes** → `<ai-governance-project>` is `<KEY>`.
- **No**, or no such entry → run the project picker and follow
  `project-picker.md`:

  ```bash
  node "${CLAUDE_SKILL_DIR}/scripts/jfrog-detect-project.mjs" "<ai-governance-server-id>"; rc=$?; true
  ```

  The key the user picks, or the value they type, is
  `<ai-governance-project>`. On **No AI Catalog**,
  `<ai-governance-project>` is empty.

If Step 4's save command (`jfrog-ai-governance-config.mjs set`) rejects the
project key, say *"`<input>` isn't a
project key. Which AI Governance project on `<ai-governance-host>` do
you want to use? If you don't use AI Catalog, say so."*, where `<input>` is
the rejected value; the answer is the next `<ai-governance-project>`
(empty if they don't use AI Catalog). Ask this once; if the save command
rejects the second answer too, show its error and stop — nothing is saved,
and the user can run `/jfrog-init` again once they have the key.

`setup.json` holds only public identifiers (server IDs, URLs, project
keys) — never a token.
