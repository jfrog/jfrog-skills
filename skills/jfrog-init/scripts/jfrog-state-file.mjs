#!/usr/bin/env node
// jfrog-state-file.mjs — read/write the /jfrog-init state file at
// ~/.jfrog/setup.json. Keyed by JFrog CLI server ID so a machine
// with multiple JPDs stays coherent.
//
// File shape (versioned; consumers MUST tolerate unknown top-level keys):
//   {
//     "version": 1,
//     "servers": {
//       "<serverId>": {
//         "jpdUrl": "https://acme.jfrog.io",
//         "currentActiveProject": "widgets"
//       }
//     }
//   }
// `currentActiveProject` is OPTIONAL — a record can exist with just
// `jpdUrl` when the server is known but no project has been resolved yet
// (e.g. Step 6 hit its retry cap). Consumers MUST NOT assume it's present.
//
// Rules:
//   - Never contains secrets. Only public identifiers (server id, JPD URL,
//     project key). No timestamps — the record is a pointer to what's
//     active now, not a usage log.
//   - Read failure = empty state (no error propagated). The file is a
//     hint, not a source of truth.
//   - Writes go through a temp file + rename for atomicity so a partial
//     write can't leave broken JSON on disk. "set" also takes a
//     cross-process exclusive lock around its read-modify-write so two
//     concurrent walks updating different servers can't clobber each
//     other's record.
//   - Directory ~/.jfrog is created with mode 0700 if missing. File is
//     written with mode 0644.
//
// Usage:
//   node jfrog-state-file.mjs get <server-id>
//     -> stdout is the record's JSON (or "{}" if absent). Exit 0.
//
//   node jfrog-state-file.mjs get-current-project <server-id>
//     -> stdout is JSON {"currentActiveProject": "...", "jpdUrl": "..."}
//        (fields omitted if no record exists). Exit 0.
//
//   node jfrog-state-file.mjs set <server-id> <jpd-url> [project-key]
//     -> merges/creates the server record with the given fields.
//        [project-key] is optional — pass "" (or omit it) to record the
//        server/JPD without a currentActiveProject, e.g. when Step 6
//        couldn't resolve one. Exit 0 on success, exit 1 on write error.
//
//   node jfrog-state-file.mjs path
//     -> stdout is the absolute path to the state file. Exit 0.
//
// Any parse/write failure prints a short message to stderr and exits
// non-zero; callers can `|| true` to keep the walk moving on stateless
// paths.

import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, existsSync, unlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isMainModule } from "./lib/jf.mjs";

const STATE_DIR = join(homedir(), ".jfrog");
const STATE_PATH = join(STATE_DIR, "setup.json");
const LOCK_PATH = `${STATE_PATH}.lock`;
const CURRENT_VERSION = 1;

// Exclusive-create is atomic even across processes, so this is a real
// mutex (not just a TOCTOU-prone existsSync check) guarding the
// read-modify-write in "set" below — two concurrent walks writing
// different servers' records must not clobber each other's update.
//
// Single attempt, no busy-wait retry loop: the record it protects is a
// best-effort "reuse last project?" hint, not a source of truth (the
// caller in jfrog-detect-all.mjs treats a write failure as a warning,
// not a walk failure) — blocking to wait out contention isn't worth the
// latency for what's allowed to be lost anyway.
//
// A process that crashes (Ctrl-C, OOM, harness timeout) while holding the
// lock never reaches releaseLock(), leaving LOCK_PATH on disk forever. To
// recover from that, a lock file older than STALE_LOCK_MS is treated as
// abandoned and removed before the one retry below.
const STALE_LOCK_MS = 30_000;

function reclaimIfStale() {
  try {
    if (Date.now() - statSync(LOCK_PATH).mtimeMs > STALE_LOCK_MS) unlinkSync(LOCK_PATH);
  } catch {
    // Lock vanished between the failed create and this check, or the
    // stat itself failed — either way there's nothing to reclaim.
  }
}

function acquireLock() {
  try {
    writeFileSync(LOCK_PATH, String(process.pid), { flag: "wx" });
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    reclaimIfStale();
    try {
      writeFileSync(LOCK_PATH, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
}

function releaseLock() {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // Already gone (or never acquired) — nothing to clean up.
  }
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { version: CURRENT_VERSION, servers: {} };
  try {
    const raw = readFileSync(STATE_PATH, "utf8");
    if (!raw.trim()) return { version: CURRENT_VERSION, servers: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { version: CURRENT_VERSION, servers: {} };
    }
    if (!parsed.servers || typeof parsed.servers !== "object") {
      parsed.servers = {};
    }
    return parsed;
  } catch {
    // Corrupt file — treat as empty so the walk doesn't hard-stop on a
    // stale hint. The write path will overwrite it next time we save.
    return { version: CURRENT_VERSION, servers: {} };
  }
}

function ensureStateDir() {
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
}

function saveState(state) {
  ensureStateDir();
  const tmp = `${STATE_PATH}.tmp.${process.pid}`;
  try {
    // "wx" refuses to follow/overwrite anything already at tmp (e.g. a
    // pre-planted symlink) — same symlink-safe pattern as
    // lib/project-cache.mjs's writeCachedProjectList().
    writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o644, flag: "wx" });
    // Not redundant with the `mode` above, despite looking it: writeFileSync's
    // mode is masked by the process umask at creation, so under a restrictive
    // umask (0077, common on hardened machines) the file lands at 0600 and the
    // documented 0644 contract at the top of this file silently doesn't hold.
    // chmod is not umask-masked, so it forces the mode after the fact.
    chmodSync(tmp, 0o644);
    renameSync(tmp, STATE_PATH);
  } catch (err) {
    // A run killed between the write and the rename (Ctrl-C, OOM, harness
    // timeout) leaves tmp behind; the name is only unique per PID, so the
    // next run to reuse that PID would otherwise hit EEXIST here forever.
    try {
      unlinkSync(tmp);
    } catch {
      // Never created, already renamed, or not ours to remove.
    }
    throw err;
  }
}

// Exported so jfrog-detect-all.mjs can call this in-process instead of
// shelling out to a `node` subprocess — the same in-process pattern
// jfrog-resolve-jf-server.mjs / jfrog-resolve-mcp-config.mjs /
// jfrog-substitute-mcp-placeholders.mjs use. Returns { ok, error } instead
// of writing to stderr and calling process.exit(), so an in-process
// caller decides for itself how to surface a failure (jfrog-detect-all.mjs
// treats it as a warning, not a walk failure).
//
// The lock is released explicitly on every path (not via try/finally) to
// mirror the CLI wrapper's exit-code contract below exactly.
export function setStateForServer(serverId, jpdUrl, projectKey) {
  if (!serverId || !jpdUrl) {
    return { ok: false, error: "set requires <server-id> <jpd-url> [project-key]" };
  }
  // The lock file lives in STATE_DIR too, so it must exist before
  // acquireLock() — not just before saveState() — or the very first
  // write on a machine where ~/.jfrog doesn't exist yet (nothing has
  // run `jf config add` or otherwise created it) fails with ENOENT.
  let locked;
  try {
    ensureStateDir();
    locked = acquireLock();
  } catch (err) {
    return { ok: false, error: `write failed: ${err.message}` };
  }
  if (!locked) {
    // Lock not acquired (stale lock file from a crashed process, or
    // genuine contention) — fail rather than doing the read-modify-write
    // unprotected, which would defeat the whole point of the lock.
    return { ok: false, error: "could not acquire lock — another /jfrog-init walk may be writing state; try again" };
  }
  try {
    const state = loadState();
    state.version = CURRENT_VERSION;
    state.servers = state.servers || {};
    // Replace the record wholesale rather than spreading the previous
    // one forward — otherwise a stale legacy key (e.g. from an older
    // state-file schema) would linger alongside the current fields.
    // Exception: an empty projectKey means THIS walk didn't resolve a
    // project (e.g. Step 6 hit its retry cap), not that the server has
    // no project — carry the previous currentActiveProject forward
    // rather than erasing a still-possibly-valid "reuse CURRENT?" hint
    // over what's likely a transient miss.
    const previous = state.servers[serverId];
    state.servers[serverId] =
      projectKey ? { jpdUrl, currentActiveProject: projectKey }
      : previous?.currentActiveProject ? { jpdUrl, currentActiveProject: previous.currentActiveProject }
      : { jpdUrl };
    saveState(state);
    releaseLock();
    return { ok: true };
  } catch (err) {
    releaseLock();
    return { ok: false, error: `write failed: ${err.message}` };
  }
}

if (isMainModule(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);

  // Sets process.exitCode rather than calling process.exit() — a forced
  // exit can truncate a still-draining stdout write, and every mode below
  // is a caller reading that stdout for its result. Every branch now needs
  // its own explicit `break` (process.exit() used to provide that for
  // free by terminating the process outright).
  switch (mode) {
    case "path":
      process.stdout.write(STATE_PATH);
      process.exitCode = 0;
      break;

    case "get": {
      const serverId = args[0];
      if (!serverId) {
        process.stdout.write("{}");
        process.exitCode = 0;
        break;
      }
      const state = loadState();
      const rec = state.servers?.[serverId];
      process.stdout.write(rec ? JSON.stringify(rec) : "{}");
      process.exitCode = 0;
      break;
    }

    case "get-current-project": {
      const serverId = args[0];
      if (!serverId) {
        process.stdout.write("{}");
        process.exitCode = 0;
        break;
      }
      const state = loadState();
      const rec = state.servers?.[serverId];
      const out = {};
      if (rec && typeof rec.currentActiveProject === "string") out.currentActiveProject = rec.currentActiveProject;
      if (rec && typeof rec.jpdUrl === "string") out.jpdUrl = rec.jpdUrl;
      process.stdout.write(JSON.stringify(out));
      process.exitCode = 0;
      break;
    }

    case "set": {
      const [serverId, jpdUrl, projectKey] = args;
      const result = setStateForServer(serverId, jpdUrl, projectKey);
      if (!result.ok) {
        process.stderr.write(`state-file: ${result.error}\n`);
        process.exitCode = 1;
        break;
      }
      process.exitCode = 0;
      break;
    }

    default:
      process.stderr.write(`state-file: unknown mode ${JSON.stringify(mode)}\n`);
      process.exitCode = 1;
  }
}
