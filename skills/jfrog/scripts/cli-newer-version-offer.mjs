#!/usr/bin/env node
// cli-newer-version-offer.mjs — Read the pending CLI upgrade flag.
//
// Cross-platform port of cli-newer-version-offer.sh.
//
// check-environment.mjs is the only writer of suggest_upgrade (true when
// latest is first evaluated or replaced and is strictly newer than
// cli_version). This script only reads that bool; --clear writes false as
// soon as the agent has read NEWER_AVAILABLE. It does not run jf.
//
// --clear means "mark this latest as already offered", not "clear the cache":
// it flips suggest_upgrade to false and deliberately leaves cli_version and
// latest_version_available intact, which is what makes the next offer wait for
// a genuinely new latest instead of re-offering this one.
//
// JFROG_CLI_AVOID_NEW_VERSION_WARNING=true (case-insensitive, same check as the
// jf CLI's own new-version warning) forces SKIP without touching the cache.
//
// Usage:
//   node cli-newer-version-offer.mjs
//   node cli-newer-version-offer.mjs --clear
//
// stdout (exactly one line, always exit 0):
//   SKIP
//   NEWER_AVAILABLE <cli_version> <latest_version_available>

import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const JFROG_HOME = process.env.JFROG_CLI_HOME_DIR || join(homedir(), ".jfrog");
const CACHE_DIR = join(JFROG_HOME, "skills-cache");
const CACHE_FILE = join(CACHE_DIR, "jfrog-skill-state.json");

function emit(line) {
  process.stdout.write(`${line}\n`);
  process.exit(0);
}

function readCache() {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

// Best-effort, atomic: a failed write must never fail the offer.
function writeCache(state) {
  const tmp = join(CACHE_DIR, `.jfrog-skill-state.${process.pid}.tmp`);
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(state)}\n`);
    renameSync(tmp, CACHE_FILE);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Nothing more to clean up.
    }
  }
}

const cache = readCache();

if (process.argv[2] === "--clear") {
  if (cache) writeCache({ ...cache, suggest_upgrade: false });
  emit("SKIP");
}

if (
  (process.env.JFROG_CLI_AVOID_NEW_VERSION_WARNING ?? "").toLowerCase() ===
  "true"
) {
  emit("SKIP");
}

if (cache?.suggest_upgrade === true) {
  emit(
    `NEWER_AVAILABLE ${cache.cli_version ?? ""} ${cache.latest_version_available ?? ""}`,
  );
}
emit("SKIP");
