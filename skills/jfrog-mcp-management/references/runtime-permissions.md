# Runtime permissions

Each operation requires different runtime access. Grant per the table below,
or the commands fail (`Forbidden`, empty output) or the Step 0 check returns
a false "disabled" result.

| Operation | What it needs |
| --- | --- |
| Step 0 check (`node …check.mjs`) | Outbound HTTPS to the JFrog platform. When credentials come from `jf config`: also execute `jf` and read `$JFROG_CLI_HOME_DIR` when set, or `~/.jfrog/` otherwise |
| `--inspect`, `--list-available` | Outbound HTTPS to the npm registry + JFrog platform; write `~/.npm/_npx` (npx cache) |
| OAuth `--login` | Same as above, plus browser launch and write `~/.jfrog/jfrogmcp.conf.json` |
| Removing an MCP config entry | Read both project and user harness MCP config files; write the matched file(s) (e.g. `.cursor/mcp.json`, `.mcp.json`). No network |
| Clearing an OAuth cache key | Read + write `~/.jfrog/jfrogmcp.conf.json`. No network |

How that access is granted depends on the agent. Some agents (e.g. Claude Code)
read the skill's optional `allowed-tools` frontmatter to pre-approve the
specific commands the skill runs, so the user is not prompted per call; others
prompt for approval or use their own permission model. Either way the skill
works — an agent that does not honor `allowed-tools` just asks the user to
approve the command. Do NOT treat `allowed-tools` as the permission mechanism;
it is only a convenience where supported.
