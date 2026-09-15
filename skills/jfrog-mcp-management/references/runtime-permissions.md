# Runtime permissions

The Step 0 Agent Guard check and the agent guard commands make outbound HTTPS
calls, and some operations also write under `~/.jfrog/`. Grant the matching
runtime access, or the commands fail (`Forbidden`, empty output) or the Step 0
check returns a false "disabled" result.

| Operation | What it needs |
| --- | --- |
| Step 0 check, `--inspect`, `--list-available` | Network: outbound HTTPS to the npm registry and the JFrog platform |
| OAuth `--login`, removing a cached entry | Network + write access to `~/.jfrog/` (`jfrogmcp.conf.json`) |

How that access is granted depends on the agent. Some agents (e.g. Claude Code)
read the skill's optional `allowed-tools` frontmatter to pre-approve the
specific commands the skill runs, so the user is not prompted per call; others
prompt for approval or use their own permission model. Either way the skill
works — an agent that does not honor `allowed-tools` just asks the user to
approve the command. Do NOT treat `allowed-tools` as the permission mechanism;
it is only a convenience where supported.
