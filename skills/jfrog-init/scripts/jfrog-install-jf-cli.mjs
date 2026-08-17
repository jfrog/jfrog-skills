#!/usr/bin/env node
// Installs the JFrog CLI (`jf`), trying progressively more self-contained
// methods:
//
//   Plan A: `npm install -g jfrog-cli-v2-jf` against whatever registry npm
//           is already configured for — the method JFrog's own docs
//           describe (docs.jfrog.com/integrations/docs/download-and-install-the-jfrog-cli#npm).
//   Plan B: the same npm install, retried against the public npm registry
//           directly (this one command only — never touches the user's
//           persisted npm config) if Plan A failed and a different
//           registry was configured. `jfrog-cli-v2-jf` is a PUBLIC
//           package, so a private/corporate registry's own (possibly
//           stale) auth says nothing about whether the package itself is
//           reachable — commonly pre-configured on a company machine.
//   Plan C: if npm is missing, or A and B both failed for any other
//           reason (observed in practice: a global npm prefix that
//           requires sudo), fall back to a direct first-party binary
//           download to ~/.jfrog/bin — a user-owned prefix that never
//           needs elevated permissions, checksum-verified against
//           Artifactory's own SHA-256 for that same artifact. On
//           Windows, where the direct-download path isn't reliable,
//           prints a PowerShell one-liner instead and returns non-zero
//           for the caller to relay to the user.
//
// Known trade-off of Plans A/B (called out in JFrog's own docs, not
// something this script can detect or fix): if the user relies on a
// shim-based version manager (nvm / Volta) alongside another `jf` install
// (Homebrew, curl, or Plan C itself), the version manager's bin/ takes
// PATH priority, so the npm-installed `jf` silently wins regardless of
// what those other installs report.
//
// PATH: Plans A/B rely on npm's global bin already being on PATH — no
// PATH changes made here. Plan C's ~/.jfrog/bin is NOT on PATH by
// default, so a successful Plan C prints a shell line the caller should
// `eval` for the CURRENT process (Plans A/B print nothing extra, since
// there's nothing to add), and persists the same PATH addition to the
// user's shell rc file so future terminals see it automatically.
//
// Usage: node jfrog-install-jf-cli.mjs
//
// Also doubles as the "Update jf" action (see
// references/jf-cli-update-prompt.md) when an already-present `jf` is
// below the skill's minimum version — currentJfIsUpToDate() below is
// what tells "nothing to do" apart from "needs installing/updating".
//
// Exit 0 -> installed, updated, or already present and up to date, and
//           `jf` resolves at >= the minimum version.
// Exit 1 -> every plan failed (or Windows, where Plan C can't run
//           automatically). Falls back to printing a manual command.

import { mkdirSync, writeFileSync, renameSync, chmodSync, readFileSync, appendFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { jfAvailable, invalidateJfAvailableCache, runJf, JF_BIN_DIR } from "./lib/jf.mjs";
import { commandExists, prependToPathIfMissing, resolveBinaryDir } from "./lib/command.mjs";
import { MIN_JF_VERSION, isOlderThan } from "./jfrog-detect-jf-cli.mjs";

const MANUAL_INSTALL_CMD = "npm install -g jfrog-cli-v2-jf";
const PUBLIC_REGISTRY = "https://registry.npmjs.org/";

const INSTALL_DIR = JF_BIN_DIR;
const INSTALL_PATH = join(INSTALL_DIR, "jf");
const RELEASE_BASE = "https://releases.jfrog.io/artifactory/jfrog-cli/v2-jf/[RELEASE]";
const PATH_LINE = 'export PATH="$HOME/.jfrog/bin:$PATH"';
const FISH_PATH_LINE = 'set -gx PATH "$HOME/.jfrog/bin" $PATH';

const log = (msg) => process.stderr.write(msg + "\n");

// Set by tryNpmInstall() on failure, read by the final "all methods
// failed" branch at the bottom of this file. Kept out of the routine
// progress log — see tryNpmInstall()'s own comment — since the raw npm
// error text/exit code (and the specific configured registry, which can
// be an org-internal hostname) is only actually useful to the user once
// Plan C has ALSO failed and there's a real problem to debug; printing it
// unconditionally makes an ultimately-successful install (npm failed, but
// Plan C quietly saved it) look like something went wrong.
let npmFailureDetail = "";

// ---------------- Plans A/B: npm ----------------

// Windows resolves `npm` to `npm.cmd`, which Node's spawnSync only finds
// via `shell: true` — a bare spawnSync("npm", ...) there fails with ENOENT
// even though npm is genuinely installed. Args here are all static
// strings (never user input), so shell:true carries no injection risk.
const NPM_SPAWN_OPTS = { shell: process.platform === "win32" };

function npmInstall(extraArgs = []) {
  return spawnSync("npm", ["install", "-g", "jfrog-cli-v2-jf", ...extraArgs], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
    encoding: "utf8",
    ...NPM_SPAWN_OPTS,
  });
}

function currentRegistry() {
  const res = spawnSync("npm", ["config", "get", "registry"], { encoding: "utf8", timeout: 10_000, ...NPM_SPAWN_OPTS });
  return (res.stdout || "").trim();
}

// Shared by selfHealNpmPath() below and tryNpmInstall()'s Plan B retry
// guard, which needs this same directory to tell "npm's own install is
// shadowed by something earlier on PATH" apart from "npm served a stale
// version" — see the guard's comment.
function resolveNpmBinDir() {
  let prefix;
  try {
    prefix = execFileSync("npm", ["config", "get", "prefix"], { encoding: "utf8", timeout: 10_000, ...NPM_SPAWN_OPTS }).trim();
  } catch {
    return "";
  }
  if (!prefix) return "";
  return process.platform === "win32" ? prefix : join(prefix, "bin");
}

// npm's global bin dir isn't always on the CURRENT process's PATH (custom
// prefix, some CI/sandbox images) even right after a genuinely successful
// `npm install -g`. Without this, that PATH gap gets misread as npm
// itself having failed — see tryNpmInstall() below.
function selfHealNpmPath() {
  const binDir = resolveNpmBinDir();
  if (binDir) prependToPathIfMissing(binDir);
}

function tryNpmInstall() {
  if (!commandExists("npm")) {
    npmFailureDetail = "npm not found";
    return false;
  }
  let result = npmInstall();
  if (result.status === 0) {
    selfHealNpmPath();
    invalidateJfAvailableCache();
  }
  // Gate the retry (and the final success check below) on
  // currentJfIsUpToDate(), not just jfAvailable() — jfAvailable() alone
  // only proves *some* jf resolves on PATH, not that it's the one npm
  // just installed. A jf from Homebrew/a version manager sitting earlier
  // on PATH (see the file-header trade-off note) would otherwise read as
  // "installed" here even though it's still below MIN_JF_VERSION.
  //
  // But when npm itself reported success (result.status === 0) and the
  // resolving jf is still stale, that has two distinct causes that need
  // different handling: either npm's own global bin now holds a stale
  // build (the configured registry served an old/pinned version — the
  // retry below, and its Curation note, are accurate for this case), or
  // npm's install is fine but something earlier on PATH is shadowing it
  // (the file-header trade-off) — no registry retry fixes that, and
  // retrying anyway would misreport "Install via <registry> failed" for
  // a registry that never actually failed. Told apart by WHERE the
  // currently-resolving jf lives, not by npm's exit code.
  if (result.status === 0 && !currentJfIsUpToDate()) {
    const npmBinDir = resolveNpmBinDir();
    const jfDir = resolveBinaryDir("jf");
    if (npmBinDir && jfDir && jfDir !== npmBinDir) {
      npmFailureDetail =
        `the \`jf\` resolving on PATH is at ${jfDir}, not npm's global bin (${npmBinDir}) — another jf install ` +
        "earlier on PATH (Homebrew, a version manager, or Plan C) is shadowing it. Retrying against a different " +
        "registry would not fix this; move npm's global bin ahead of it on PATH, or remove the other install.";
      return false;
    }
  }

  if (result.status !== 0 || !currentJfIsUpToDate()) {
    const registry = currentRegistry();
    if (registry && registry !== PUBLIC_REGISTRY) {
      result = npmInstall([`--registry=${PUBLIC_REGISTRY}`]);
      if (result.status === 0) {
        selfHealNpmPath();
        invalidateJfAvailableCache();
        // On stdout, not just the stderr log above — this is the one line
        // a caller relaying results to the user is most likely to surface,
        // and installing outside the configured registry means this one
        // package bypassed Artifactory/Curation, not something to report
        // as a plain, uneventful success.
        console.log(
          `Note: installed jfrog-cli-v2-jf from the public npm registry (${PUBLIC_REGISTRY}) ` +
            `because the configured registry (${registry}) failed — this install bypassed Artifactory/Curation.`
        );
      }
    }
  }
  if (result.status === 0 && currentJfIsUpToDate()) {
    log("Installed JFrog CLI via npm.");
    return true;
  }
  if (result.status === 0) {
    // npm itself reported success, but the jf that resolves on PATH still
    // isn't the up-to-date one afterward (selfHealNpmPath() couldn't
    // find/fix the gap — e.g. a non-standard prefix — or a different jf
    // earlier on PATH is shadowing the one npm just installed). Reporting
    // this the same way as an actual npm failure below would print the
    // nonsensical "npm install failed (exit code 0)" — npm didn't fail,
    // what's on PATH afterward did.
    npmFailureDetail = jfAvailable()
      ? "npm install reported success, but the `jf` resolving on PATH is still below the minimum version afterward."
      : "npm install reported success, but `jf` still isn't resolving on PATH afterward.";
    return false;
  }
  // A timed-out spawnSync sets `result.error.code === "ETIMEDOUT"` and
  // kills the child, but the child can still have written something to
  // stderr before being killed (e.g. a stray npm warning unrelated to the
  // real cause) — checking `result.stderr` first would report that noise
  // as "why npm install failed" instead of the actual 120s timeout. The
  // two execFileSync-based detectors already check `.code === "ETIMEDOUT"`
  // first for the identical reason; this spawnSync path missed it.
  const reason =
    result.error && result.error.code === "ETIMEDOUT"
      ? "timed out after 120s"
      : (result.stderr || "").trim() || (result.error ? result.error.message : `exit code ${result.status}`);
  npmFailureDetail = reason;
  return false;
}

// ---------------- Plan C: direct binary download ----------------

// tryDirectDownload()'s Windows branch already prints a platform-specific
// PowerShell command and returns non-success — the generic
// MANUAL_INSTALL_CMD fallback at the bottom of this file must NOT also
// print afterward in that case, or the user sees two conflicting install
// commands with the one that just failed (npm) printed last, reading as
// the recommended next step. This sentinel lets the caller tell "failed,
// nothing printed yet" apart from "failed, but already told the user what
// to run" without a boolean losing that distinction.
const PLATFORM_COMMAND_PRINTED = "platform-command-printed";

// The line the caller should `eval` in the *current* shell — must match
// whatever syntax that shell understands. Fish has no `export`, so an
// eval of PATH_LINE there is a silent no-op and `jf` stays unresolved for
// the rest of the process despite a successful install.
function evalPathLine() {
  return (process.env.SHELL || "").includes("fish") ? FISH_PATH_LINE : PATH_LINE;
}

// Idempotently appends the PATH line to the user's shell rc so future
// terminals see `jf` without the user editing anything themselves.
function persistOnPath() {
  const shell = process.env.SHELL || "";
  const line = evalPathLine();
  let rcPath;
  if (shell.includes("fish")) {
    rcPath = join(homedir(), ".config", "fish", "config.fish");
  } else if (shell.includes("zsh")) {
    rcPath = join(homedir(), ".zshrc");
  } else if (shell.includes("bash")) {
    rcPath = join(homedir(), ".bashrc");
  } else {
    rcPath = join(homedir(), ".profile");
  }

  let existing = "";
  try {
    existing = readFileSync(rcPath, "utf8");
  } catch {
    existing = "";
  }
  if (existing.includes(line)) return;

  try {
    mkdirSync(join(rcPath, ".."), { recursive: true });
    appendFileSync(rcPath, `\n# Added by JFrog CLI installer (/jfrog-init)\n${line}\n`);
    log(`Added ~/.jfrog/bin to PATH in ${rcPath} — new terminals will see \`jf\` directly.`);
  } catch (err) {
    log(`Could not update ${rcPath} automatically (${err.message}); add this line yourself:\n  ${line}`);
  }
}

// JFrog ships separate macOS binaries per arch: "mac-386" (a historical
// name, not the arch — this one is actually x64) for Intel, "mac-arm64"
// for Apple Silicon. There's no universal/fat binary to fall back on.
function pickArtifact() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "jfrog-cli-mac-arm64/jf" : "jfrog-cli-mac-386/jf";
  }
  if (process.platform === "linux") {
    switch (process.arch) {
      case "x64":
        return "jfrog-cli-linux-amd64/jf";
      case "arm64":
        return "jfrog-cli-linux-arm64/jf";
      case "arm":
        return "jfrog-cli-linux-arm/jf";
      case "ia32":
        return "jfrog-cli-linux-386/jf";
      default:
        return null;
    }
  }
  return null;
}

async function tryDirectDownload() {
  if (process.platform === "win32") {
    log("Windows detected — the direct-download fallback is not supported here.");
    const winArtifactUrl = `${RELEASE_BASE}/jfrog-cli-windows-amd64/jf.exe`;
    // Same fail-closed policy as the macOS/Linux path below: this printed
    // command is never actually run by this process, so if Artifactory
    // won't hand back a checksum to embed, refuse to print a command that
    // would install an unverified binary rather than silently downgrading
    // to one.
    const expectedSha256 = await fetchChecksumHeader(winArtifactUrl);
    if (!expectedSha256) {
      log(`Could not obtain an expected checksum for ${winArtifactUrl} — refusing to install an unverified binary.`);
      return false;
    }
    // User-owned path + user-scope PATH (setx, no /M) — same "no admin
    // needed" contract as macOS/Linux above. Do NOT install to
    // $env:SYSTEMROOT\system32: that requires an elevated prompt just to
    // place an unverified download in a directory shared by every user
    // and process on the machine, for no benefit over a per-user install.
    // $env:Path is the PROCESS Path — machine and user scopes already
    // concatenated. `setx PATH "...;$env:Path"` would write that combined
    // value into the user-scope variable, duplicating every machine-level
    // entry into it (and freezing them there, shadowing future machine
    // PATH changes), plus setx silently truncates at 1024 characters — a
    // real risk on a dev machine with a long PATH. Read/write the
    // user-scope value only, via [Environment]::GetEnvironmentVariable /
    // SetEnvironmentVariable, so this only ever prepends to what the user
    // scope already had.
    // PowerShell's `-ne` string comparison is case-insensitive by default,
    // so the mixed-case hex Get-FileHash returns compares fine against the
    // lowercase hex from the checksum header.
    console.log(`Run in PowerShell:
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.jfrog\\bin" | Out-Null; iwr ${winArtifactUrl} -OutFile "$env:USERPROFILE\\.jfrog\\bin\\jf.exe"; if ((Get-FileHash "$env:USERPROFILE\\.jfrog\\bin\\jf.exe" -Algorithm SHA256).Hash -ne "${expectedSha256}") { Remove-Item "$env:USERPROFILE\\.jfrog\\bin\\jf.exe" -Force; Write-Error "Checksum mismatch - aborting install"; exit 1 }; $userPath = [Environment]::GetEnvironmentVariable('Path','User'); [Environment]::SetEnvironmentVariable('Path', "$env:USERPROFILE\\.jfrog\\bin;$userPath", 'User')`);
    return PLATFORM_COMMAND_PRINTED;
  }

  const artifact = pickArtifact();
  if (!artifact) {
    log(`Unsupported OS/arch (${process.platform} / ${process.arch}) for direct download.`);
    return false;
  }

  const url = `${RELEASE_BASE}/${artifact}`;
  mkdirSync(INSTALL_DIR, { recursive: true });

  // Artifactory answers HEAD directly with an X-Checksum-Sha256 header
  // (verified live); the actual GET below redirects to a CDN-backed cache
  // for the bytes themselves, which does NOT carry that header. If the
  // HEAD followed the same redirect automatically, `fetch()` would hand
  // back the CDN's headers instead of Artifactory's, silently losing the
  // checksum — so redirects are handled manually here, and the header is
  // read off Artifactory's own response before it's followed.
  // Issued concurrently with the GET below (independent round trips to
  // the same URL) rather than awaited first, since the checksum is only
  // needed after the download completes anyway.
  async function fetchChecksumHeader(target) {
    try {
      const res = await fetch(target, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(30_000) });
      return res.headers.get("x-checksum-sha256") || "";
    } catch {
      return "";
    }
  }
  const headPromise = fetchChecksumHeader(url);
  // Best-effort — if the HEAD fails, the GET below still gets a real
  // download; it just won't be checksum-verified.

  let bytes;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    log(`Download failed (${err.message}).`);
    return false;
  }

  const expectedSha256 = await headPromise;

  if (!bytes.length) {
    log("Downloaded file is empty.");
    return false;
  }

  // Comparing against the checksum Artifactory computed server-side (from
  // the HEAD above) catches a truncated/corrupted transfer. It's not an
  // independent signature (both come from the same Artifactory instance),
  // so it can't prove the artifact itself is untampered; a real fix would
  // need a separately-published signature, which releases.jfrog.io
  // doesn't offer today. This deliberately doesn't pin a specific CLI
  // version either: it tracks "latest" the same way JFrog's own installer
  // scripts do, so pinning here would just mean maintaining a
  // version/checksum matrix that drifts from upstream.
  if (expectedSha256) {
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== expectedSha256) {
      log(`Downloaded file's checksum doesn't match Artifactory's (expected ${expectedSha256}, got ${actualSha256}).`);
      return false;
    }
  } else {
    // fetchChecksumHeader() swallows its own errors and returns "" for
    // anything from a timeout to a missing header. This is Plan C — npm
    // (Plans A/B) is always tried first and is the one path JFrog's own
    // docs describe — so failing closed here (rather than installing an
    // unverified binary with just a log line, indistinguishable from a
    // verified one to a caller that only checks the exit code) costs
    // little: the caller still gets MANUAL_INSTALL_CMD to hand the user.
    log(`Could not obtain an expected checksum for ${url} — refusing to install an unverified binary.`);
    return false;
  }

  // Rules out a JFrog-branded HTML error page silently written to disk:
  // non-empty, and either an ELF or Mach-O binary.
  const magic = bytes.subarray(0, 4).toString("hex");
  const validMagic = ["7f454c46", "cffaedfe", "cefaedfe", "feedface", "feedfacf", "cafebabe"];
  if (!validMagic.includes(magic)) {
    log(`Downloaded file does not look like a binary (magic=${magic}).`);
    return false;
  }

  // Written inside INSTALL_DIR (not the OS tmpdir) so the final rename is
  // guaranteed to land on the same filesystem — a cross-filesystem rename
  // (e.g. tmpfs /tmp vs a separately-mounted $HOME) fails with EXDEV.
  const tmp = join(INSTALL_DIR, `.jf.tmp.${process.pid}`);
  // Wrapped because "wx" throws EEXIST rather than overwriting, and the
  // name is only unique per PID: a run killed between the write and the
  // rename (Ctrl-C, OOM, harness timeout) leaves the temp file behind,
  // and the next run to reuse that PID hits it. Unhandled, that replaces
  // the caller's "all install methods failed, here's the manual command"
  // fallback with a raw stack trace, at the end of a flow that has
  // already spent a while failing. EPERM/ENOSPC on the chmod/rename land
  // here too.
  try {
    // "wx" refuses to follow/overwrite anything already at tmp (e.g. a
    // pre-planted symlink) — same symlink-safe pattern as
    // lib/project-cache.mjs's writeCachedProjectList().
    writeFileSync(tmp, bytes, { flag: "wx" });
    chmodSync(tmp, 0o755);
    renameSync(tmp, INSTALL_PATH);
  } catch (err) {
    log(`Could not write ${INSTALL_PATH} (${err.message}).`);
    // Best-effort cleanup so a failure here doesn't poison the next run
    // with the very leftover that may have caused it.
    try {
      unlinkSync(tmp);
    } catch {
      // Never created, already renamed, or not ours to remove.
    }
    return false;
  }

  // A checksum match only proves the bytes weren't corrupted in transit —
  // it says nothing about whether this binary actually executes on the
  // current OS/libc (e.g. a glibc/musl mismatch on Linux). Run it before
  // reporting success so a broken binary surfaces here, not as a
  // confusing "jf: command not found" later.
  try {
    execFileSync(INSTALL_PATH, ["--version"], { timeout: 10_000, stdio: "ignore" });
  } catch (err) {
    log(`Downloaded binary does not run (${err.message}).`);
    return false;
  }

  log(`Installed JFrog CLI at ${INSTALL_PATH}.`);
  persistOnPath();
  console.log(evalPathLine());
  return true;
}

// ---------------- Main ----------------

// jfAvailable() alone only proves `jf` resolves on PATH — not that it
// satisfies this skill's minimum version (see MIN_JF_VERSION in
// jfrog-detect-jf-cli.mjs). This script is also the action behind
// jf-cli-update-prompt.md's "Update it now?" (jf present, but outdated) —
// without this version check, that path silently no-oped here instead of
// actually running an install.
function currentJfIsUpToDate() {
  if (!jfAvailable()) return false;
  try {
    const version = runJf(["--version"]).trim().split("\n")[0] || "";
    return !isOlderThan(version, MIN_JF_VERSION);
  } catch {
    return false;
  }
}

// Sets process.exitCode rather than calling process.exit() — same reason
// every detector does: a forced exit can truncate a still-draining stdout
// write, and MANUAL_INSTALL_CMD below is the one thing a caller of this
// script actually needs on the failure path.
if (currentJfIsUpToDate()) {
  log("JFrog CLI already installed and up to date.");
  process.exitCode = 0;
} else if (tryNpmInstall()) {
  process.exitCode = 0;
} else {
  const directResult = await tryDirectDownload();
  if (directResult === true) {
    process.exitCode = 0;
  } else {
    // Skip the generic fallback when a platform-specific command was
    // already printed (Windows) — printing MANUAL_INSTALL_CMD too would
    // show a second, conflicting install command, with the one that just
    // failed (npm) last.
    if (directResult !== PLATFORM_COMMAND_PRINTED) {
      // Only now is npmFailureDetail (whatever tryNpmInstall() stashed —
      // npm missing, a raw npm error, or a PATH-shadowing/stale-jf
      // diagnostic — instead of logging it immediately) worth showing —
      // Plan C has also failed, so there's a real problem to debug
      // rather than an ultimately-successful install that merely took a
      // detour through a registry retry or a direct download.
      log(
        npmFailureDetail
          ? `All install methods failed (npm: ${npmFailureDetail}). Falling back to manual command.`
          : "All install methods failed. Falling back to manual command."
      );
      console.log(MANUAL_INSTALL_CMD);
    }
    process.exitCode = 1;
  }
}
