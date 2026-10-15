// claude.mjs — the Claude Code CLI.

import { resolveCommand, runCommand } from "./command.mjs";

const CLAUDE_TIMEOUT_MS = 30_000;

export const SHELL_UNSAFE = /[&|;$<>`"'\\^\s]/;

export const claude = resolveCommand("claude");

// "2.1.295 (Claude Code)" -> "2.1.295"; "" when unreadable.
export function claudeVersion() {
  const { ok, stdout } = runCommand(claude, ["--version"], { timeoutMs: CLAUDE_TIMEOUT_MS });
  return ok ? /^\s*(\d+\.\d+\.\d+)/.exec(stdout)?.[1] || "" : "";
}

// By name only: `marketplace add` has no way to set a headersHelper.
export function marketplaceUpdate(name) {
  if (claude.shell && SHELL_UNSAFE.test(name)) {
    return { ok: false, out: "marketplace name has a character the Windows claude shim cannot pass.\n" };
  }
  return runCommand(claude, ["plugin", "marketplace", "update", name], { timeoutMs: CLAUDE_TIMEOUT_MS });
}

// The names claude itself reports as registered, or null when unreadable.
export function marketplaceNames() {
  const { ok, stdout } = runCommand(claude, ["plugin", "marketplace", "list", "--json"], { timeoutMs: CLAUDE_TIMEOUT_MS });
  if (!ok) return null;
  try {
    const list = JSON.parse(stdout);
    return Array.isArray(list) ? list.map((entry) => entry?.name) : null;
  } catch {
    return null;
  }
}
