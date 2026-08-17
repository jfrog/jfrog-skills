// command.mjs — finds the binary behind a command name on PATH, and launches it.

import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { dirname, join, delimiter } from "node:path";

// Prepends `dir` to the current process's PATH if it isn't already
// present. Shared by every self-heal that needs this (selfHealPath()
// in jf.mjs, jfrog-install-jf-cli.mjs's selfHealNpmPath()) so the split/
// includes/prepend mechanics can't drift between the two — they differ
// only in *which* directory they're healing onto PATH.
export function prependToPathIfMissing(dir) {
  if (!dir) return;
  const dirs = (process.env.PATH || "").split(delimiter);
  if (!dirs.includes(dir)) {
    process.env.PATH = `${dir}${delimiter}${process.env.PATH || ""}`;
  }
}

// A pure-Node PATH scan — no external binary at all, so this can't be
// a shell-injection-shaped pattern (no `shell: true`, unlike the old
// `command -v` implementation) AND can't false-negative on a minimal
// image missing `which`/`where` (unlike a naive fix that just swapped in
// those external binaries instead).
export function commandExists(command) {
  return resolveBinaryDir(command) !== "";
}

// Same PATH/PATHEXT scan as commandExists() and resolveBinaryDir(), but
// returns the full matched path (dir + filename, e.g. `...\jf.cmd` on
// Windows) instead of just the directory — runJf() needs the exact
// filename it matched (not just which directory it lives in) so it can
// spawn that literal path without going through a shell to resolve a bare
// "jf" via PATHEXT.
export function resolveBinaryPath(command) {
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const names =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((ext) => command + ext.toLowerCase())
      : [command];
  for (const dir of dirs) {
    for (const name of names) {
      const full = join(dir, name);
      try {
        // Windows has no POSIX executable bit to check — F_OK (exists) is
        // the best available signal there; X_OK enforces "executable",
        // not just "present", everywhere else.
        accessSync(full, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
        return full;
      } catch {
        // Not in this PATH entry — keep looking.
      }
    }
  }
  return "";
}

// Same PATH/PATHEXT scan as commandExists(), but returns the directory the
// binary actually resolves to (first hit wins, same as PATH resolution
// order) instead of a boolean. jfrog-install-jf-cli.mjs's Plan B retry
// guard needs to know WHERE the currently-resolving `jf` lives — inside
// npm's own global bin, or shadowed by something earlier on PATH (a
// Homebrew/version-manager install) — not just whether `jf` resolves at
// all.
export function resolveBinaryDir(command) {
  const full = resolveBinaryPath(command);
  return full ? dirname(full) : "";
}

// Node refuses to spawn a Windows `.cmd` shim without `shell: true` (its fix for
// CVE-2024-27980, which Node 24 flags as DEP0190), and under a shell cmd.exe
// re-splits the line, so a path with a space needs quotes. `shell` is returned
// because such a call passes args through unescaped: callers must screen theirs.
// An unfound command yields the bare name, so the spawn still ENOENTs.
export function resolveCommand(command) {
  const path = resolveBinaryPath(command);
  const shell = /\.(cmd|bat)$/i.test(path);
  return { command, target: shell ? `"${path}"` : path || command, shell, found: path !== "" };
}

// Reports the outcome instead of throwing, so a caller can show the CLI's own
// message; execFileSync discards stdout on failure. A killed child leaves status
// null and both streams empty, so the reason goes into `out`.
export function runCommand({ command, target, shell }, args, { timeoutMs }) {
  const result = spawnSync(target, args, { encoding: "utf8", timeout: timeoutMs, shell });
  let out = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.error) {
    out += result.error.code === "ETIMEDOUT"
      ? `${command} did not respond within ${timeoutMs / 1000}s and was terminated.\n`
      : `${result.error.message}\n`;
  }
  return { ok: result.status === 0, out };
}
