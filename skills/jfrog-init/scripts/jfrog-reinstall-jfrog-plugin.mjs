#!/usr/bin/env node
// This script itself never writes to the plugin's mcp.json — the file is
// owned by the JFrog plugin (Cursor / VS Code / Claude / Codex). It only prints
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
import { homedir } from "node:os";
import { join } from "node:path";
import { detectHarness, resolveMcpConfig } from "./jfrog-resolve-mcp-config.mjs";

const harness = detectHarness();
// kiro-cli's resolveMcpConfig() writes to disk as a side effect (ensureKiroCliJfrogEntry),
// which this diagnostic-only script must never do — derive the path directly instead.
const resolved =
  harness === "kiro-cli"
    ? { path: join(homedir(), ".kiro", "settings", "mcp.json") }
    : resolveMcpConfig();

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
  case "codex":
    console.log(`Codex:
  codex plugin remove jfrog@codex-plugin            # if already installed
  codex plugin marketplace add jfrog/codex-plugin   # skip if already configured
  codex plugin marketplace upgrade codex-plugin
  codex plugin add jfrog@codex-plugin

Restart Codex, then re-run /jfrog-init.`);
    break;
  case "kiro":
    console.log(`Kiro IDE:
  Open the Powers panel → Add Custom Power → Import from GitHub →
  enter the JFrog Kiro Power repository URL.
  Restart Kiro, then re-run /jfrog-init.`);
    break;
  case "kiro-cli":
    console.log(`Kiro CLI:
  No plugin reinstall needed — the jfrog entry in ~/.kiro/settings/mcp.json
  is created automatically by /jfrog-init. Re-run /jfrog-init to recreate it.
  If /jfrog-init reports the file is invalid, open ~/.kiro/settings/mcp.json,
  fix the JSON (keep the other MCP server entries), then re-run /jfrog-init.`);
    break;
  default:
    console.log(`Reinstall the JFrog plugin in whichever IDE you're using:
  Cursor:      Settings → Plugins → search "JFrog" → reinstall.
  VS Code:     code --install-extension JFrog.jfrog-vscode-extension --force
  Claude Code: claude plugin install jfrog-beta/jfrog
  Codex:       codex plugin marketplace add jfrog/codex-plugin && codex plugin add jfrog@codex-plugin
  Kiro:        Powers panel → Add Custom Power → Import from GitHub.
  Kiro CLI:    no reinstall needed — entry is created automatically by /jfrog-init.

Restart the IDE afterwards, then re-run /jfrog-init.`);
}

console.log(`
Expected plugin-owned paths (for reference):

  Cursor:  ~/.cursor/plugins/cache/cursor-public/jfrog/<sha>/mcp.json
  VS Code: ~/.vscode/agent-plugins/github.com/jfrog/vscode-plugin/plugin/.mcp.json
  Claude:  ~/.claude/plugins/cache/<marketplace>/jfrog/<version>/.mcp.json
  Codex:   $CODEX_HOME/plugins/cache/codex-plugin/jfrog/<version>/.mcp.json
           ($CODEX_HOME defaults to ~/.codex)
  Kiro:    ~/.kiro/powers/installed/jfrog-kiro-power/mcp.json
  Kiro CLI: ~/.kiro/settings/mcp.json (not plugin-owned; created by /jfrog-init)
`);

if (resolved.path && existsSync(resolved.path)) {
  console.log(`Plugin's mcp.json currently resolves to: ${resolved.path}`);
} else if (resolved.path) {
  console.log(`Plugin's mcp.json is expected at ${resolved.path}, but nothing is there right now.`);
} else {
  console.log("Plugin's mcp.json is not on disk right now:");
  console.log(`  ${resolved.error}`);
}
