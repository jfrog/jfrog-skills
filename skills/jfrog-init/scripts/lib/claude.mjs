// claude.mjs — the Claude Code CLI.

import { resolveCommand, runCommand } from "./command.mjs";

const CLAUDE_TIMEOUT_MS = 30_000;

const SHELL_UNSAFE = /[&|;$<>`"'\\\s]/;

export const claude = resolveCommand("claude");

export function marketplaceAdd(url) {
  if (claude.shell && SHELL_UNSAFE.test(url)) {
    return { ok: false, out: "jf server URL or username has a character the Windows claude shim cannot pass.\n" };
  }
  return runCommand(claude, ["plugin", "marketplace", "add", url], { timeoutMs: CLAUDE_TIMEOUT_MS });
}
