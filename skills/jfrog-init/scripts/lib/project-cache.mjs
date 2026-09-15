#!/usr/bin/env node
// project-cache.mjs — short-lived on-disk cache of a server's enumerated
// project list (GET /access/api/v1/projects). The interactive project
// step (SKILL.md Step 6) re-invokes jfrog-detect-project.mjs once per user
// attempt within the same walk (typed guess, "Other" retry, picking a
// suggestion, ...); without this cache each attempt re-hits the network
// to re-enumerate, even though matching/similarity search against the
// list is already done offline (lib/projects.mjs). Only the enumeration
// call itself needs caching — the per-key existence probe in
// jfrog-detect-project.mjs must stay live, since it's the access/ACL check of
// record.
//
// Keyed by server ID, lives in the OS temp dir (contents are public
// project metadata — key/display name — never a secret), and expires
// after TTL_MS so a walk resumed later doesn't trust a stale list.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TTL_MS = 5 * 60 * 1000;

// A fingerprint of the credentials used to enumerate — never the raw
// token/password, just enough to detect when the identity behind a
// server-id changes (e.g. the user re-runs `jf config add --interactive`
// with a different account, or repoints the same server-id at a
// different JPD). Otherwise a stale list fetched under the old identity
// could be served to the new one.
//
// Stored INSIDE the cache file (protected by its 0600 mode) rather than
// in the filename — a filename embedding even a truncated hash of
// credential material is visible to any local user via a directory
// listing on a shared machine (e.g. `ls /tmp`), which lets someone who
// already holds (or is guessing) a candidate credential confirm a match
// without ever needing read access to the file itself. The 0600 mode
// only protects contents, not the filename, so the fingerprint has to
// live where that protection actually applies.
function fingerprint(creds) {
  return createHash("sha256")
    .update(`${creds.baseUrl}|${creds.token || ""}|${creds.user || ""}|${creds.password || ""}`)
    .digest("hex")
    .slice(0, 16);
}

// Scoped by server-id only — server IDs are non-secret labels already
// visible in `jf config show` and this skill's own detector output, so
// there's nothing sensitive in this filename.
function cachePath(serverId) {
  const safe = serverId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(tmpdir(), `jfrog-init-projects-${safe}.json`);
}

// A falsy serverId means the caller couldn't resolve which JPD it's
// talking to — caching under some shared placeholder key would let two
// different (unresolved) servers read back each other's project list.
// Skip the cache entirely rather than risk that cross-server leak.
export function readCachedProjectList(serverId, creds) {
  if (!serverId || !creds) return null;
  try {
    const parsed = JSON.parse(readFileSync(cachePath(serverId), "utf8"));
    if (!parsed || typeof parsed.fetchedAt !== "number" || parsed.body === undefined) return null;
    if (parsed.fingerprint !== fingerprint(creds)) return null;
    if (Date.now() - parsed.fetchedAt > TTL_MS) return null;
    return parsed.body;
  } catch {
    return null;
  }
}

export function writeCachedProjectList(serverId, creds, body) {
  if (!serverId || !creds) return;
  try {
    const record = { fetchedAt: Date.now(), fingerprint: fingerprint(creds), body };
    // Path is derived from server-id alone (non-secret, guessable) in a
    // shared OS temp dir — writing straight to it would let another local
    // user pre-plant a symlink there that writeFileSync's default "w"
    // flag would follow and truncate, overwriting an arbitrary file the
    // real user can write to. Writing to a per-process-unique temp name
    // first (also "wx", refusing to follow/overwrite anything already
    // there) and renaming into place instead replaces whatever directory
    // entry — file or symlink — sits at the final path, without ever
    // dereferencing it. Same pattern as jfrog-state-file.mjs.
    const target = cachePath(serverId);
    const tmp = `${target}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    renameSync(tmp, target);
  } catch {
    // Cache is a pure optimization — a write failure just means the next
    // invocation re-fetches, so it's never surfaced to the caller.
  }
}
