#!/usr/bin/env node
// This script itself never writes to the plugin's mcp.json — the file is
// owned by the JFrog plugin (Cursor / VS Code / Claude). It only prints
// the diagnosis and the correct remedy for a plugin file that's missing
// or invalid: reinstall or update the plugin, with per-harness commands
// so the user isn't left guessing. (A placeholder-only problem — e.g. an
// unresolved `${JFROG_PLATFORM_URL}` — is handled separately and
// automatically by jfrog-substitute-mcp-placeholders.mjs, the one place
// in this skill that does edit the file in place; this script is only
// reached when that auto-fix isn't applicable.)
//
// Usage: node jfrog-reinstall-jfrog-plugin.mjs
// Always exits 0 after printing.

import { existsSync } from "node:fs";
import { detectHarness, resolveMcpConfig } from "./jfrog-resolve-mcp-config.mjs";

const resolved = resolveMcpConfig();
const harness = detectHarness();

console.log(`The JFrog MCP entry lives inside the JFrog plugin's own mcp.json file.
This script never writes to it — it only diagnoses and prints the fix.

If /jfrog-init sent you here, the plugin's mcp.json is missing, empty,
or otherwise invalid, and the fix is to reinstall or update the JFrog
plugin in your IDE.
`);

switch (harness) {
  case "claude":
    console.log(`Claude Code:
  claude plugin uninstall jfrog-beta/jfrog   # if already installed
  claude plugin install jfrog-beta/jfrog

After install, restart Claude Code, then re-run /jfrog-init.`);
    break;
  case "cursor":
    console.log(`Cursor:
  Open Cursor → Settings → Plugins (or Extensions) → search "JFrog" →
  Uninstall (if present) → Install. Restart Cursor.
  Then re-run /jfrog-init.`);
    break;
  case "vscode":
    console.log(`VS Code:
  code --uninstall-extension JFrog.jfrog-vscode-extension || true
  code --install-extension JFrog.jfrog-vscode-extension --force

Restart VS Code, then re-run /jfrog-init.`);
    break;
  default:
    console.log(`Reinstall the JFrog plugin in whichever IDE you're using:
  Cursor:      Settings → Plugins → search "JFrog" → reinstall.
  VS Code:     code --install-extension JFrog.jfrog-vscode-extension --force
  Claude Code: claude plugin install jfrog-beta/jfrog

Restart the IDE afterwards, then re-run /jfrog-init.`);
}

console.log(`
Expected plugin-owned paths (for reference):

  Cursor:  ~/.cursor/plugins/cache/cursor-public/jfrog/<sha>/mcp.json
  VS Code: ~/.vscode/agent-plugins/github.com/jfrog/vscode-plugin/plugin/.mcp.json
  Claude:  ~/.claude/plugins/cache/<marketplace>/jfrog/<version>/.mcp.json
`);

if (resolved.path && existsSync(resolved.path)) {
  console.log(`Plugin's mcp.json currently resolves to: ${resolved.path}`);
} else if (resolved.path) {
  console.log(`Plugin's mcp.json is expected at ${resolved.path}, but nothing is there right now.`);
} else {
  console.log("Plugin's mcp.json is not on disk right now:");
  console.log(`  ${resolved.error}`);
}
