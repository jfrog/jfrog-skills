#!/usr/bin/env node
// Resolves the project key for the walk. The picked value is
// NEVER persisted (no env var, no shell profile) — the caller passes it as
// a positional argument on the re-invocation and threads it forward.
//
// Idempotent, read-only, zero mutation. Emits one JSON line to stdout.
//
// Why /access/... and not `jf rt curl`: `jf rt curl <path>` rewrites every
// path to `<url>/artifactory/<path>`, which 404s for non-Artifactory
// endpoints. The Projects endpoint (GetProjectsList —
// https://docs.jfrog.com/projects/reference/getprojectslist) lives under
// /access/, off the JPD root, so credentials are resolved via `jf config
// export` and a direct fetch is issued instead.
//
// Enumeration only ever runs to populate the interactive picker (no input
// passed) — see "Why no matching either" below for why a passed input skips
// it entirely. Cached per server for a few minutes (see lib/project-cache.mjs)
// since the picker can re-invoke this script more than once per walk.
//
// Usage: node jfrog-detect-project.mjs [server-id] [project-input]
//
// A no-input `ask` result carries `candidatesWithNames` (up to the full
// enumerated project list, `{key, displayName}`, sorted) whenever
// enumeration succeeded, so the caller can offer the first two as an
// interactive pick-one-or-type-your-own prompt instead of demanding the
// user type a key from memory.
//
// Exit 0 -> green (input accepted exactly as passed, in `resolvedKey` —
//                  no matching, no existence/access check; see below)
// Exit 2 -> ask   (no input passed, or multiple jf servers configured with none
//                  resolvable — caller must prompt the user and re-invoke)
// Exit 3 -> error (jf missing, or credentials unavailable/rejected)
//
// Matching against the enumerated list is also skipped: GetProjectsList
// requires Platform/Project Admin (same as the removed per-key probe), so
// non-admin callers got 403 either way. A typed input is accepted verbatim;
// enumeration only runs for the interactive picker (ask path) below.

import { emit, isMainModule, resolveCreds, authedFetch } from "./lib/jf.mjs";
import { resolveServerOrEmit } from "./jfrog-resolve-jf-server.mjs";
import { projectsWithNames, capCandidatesForDisplay } from "./lib/projects.mjs";
import { readCachedProjectList, writeCachedProjectList } from "./lib/project-cache.mjs";

// Exported so jfrog-detect-all.mjs can call this in-process instead of
// shelling out to a `node` subprocess and re-parsing its stdout — the
// same in-process pattern jfrog-resolve-jf-server.mjs /
// jfrog-resolve-mcp-config.mjs / jfrog-substitute-mcp-placeholders.mjs
// use. Returns { exitCode, resolvedKey } — resolvedKey is set on the
// green path so the caller can read it directly instead of re-parsing
// the emitted JSON line. The CLI entry point below is a thin wrapper.
//
// Every branch below emits exactly once and returns the exit code rather
// than calling process.exit() — a forced exit can truncate the JSON line
// if stdout is still draining through a pipe.
export async function detectProject(serverIdArg, projectInputArg) {
  const resolved = resolveServerOrEmit("project", serverIdArg, { status: "error", exitCode: 3 });
  if (resolved.exitCode !== null) {
    return { exitCode: resolved.exitCode };
  }
  const { serverId } = resolved;
  const projectInput = (projectInputArg || "").trim();

  // ---------- Resolve branch: an input was passed ----------
  // No matching, no existence/access probe — see "Why no matching either"
  // above. Accepted exactly as given; always green.
  if (projectInput) {
    emit({
      check: "project",
      status: "green",
      detail: `project ${projectInput} accepted — existence/access on the JPD was not verified`,
      resolvedKey: projectInput,
    });
    return { exitCode: 0, resolvedKey: projectInput };
  }

  const creds = resolveCreds(serverId);
  if (!creds) {
    emit({
      check: "project",
      status: "error",
      detail: "cannot authenticate to /access: no access token or user+password found in jf config. Re-run `jf config add --interactive`.",
    });
    return { exitCode: 3 };
  }

  // ---------- Ask branch: no input passed; return candidates ----------
  // Cached per server for a short TTL (lib/project-cache.mjs): the
  // interactive picker re-invokes this script once per user attempt within
  // the same walk, and re-enumerating on every attempt is wasted network
  // traffic.
  let list;
  const cachedBody = readCachedProjectList(serverId, creds);
  if (cachedBody !== null) {
    list = { code: 200, body: cachedBody };
  } else {
    list = await authedFetch(creds, "/access/api/v1/projects");
    if (list.code >= 200 && list.code < 300) writeCachedProjectList(serverId, creds, list.body);
  }
  const enumOk = list.code >= 200 && list.code < 300;
  const candidatesWithNames = enumOk ? projectsWithNames(list.body) : [];

  // Branches on `enumOk`, not `candidatesWithNames.length`, so a JPD with
  // zero accessible projects (enumeration succeeded, list is empty) isn't
  // misreported as "enumeration was not available".
  if (enumOk) {
    const shown = capCandidatesForDisplay(candidatesWithNames);
    emit({
      check: "project",
      status: "ask",
      detail: candidatesWithNames.length > 0
        ? shown.candidatesTotal
          ? `no project chosen — ask the user which project to use (showing ${shown.candidatesWithNames.length} of ${shown.candidatesTotal})`
          : "no project chosen — ask the user which project to use"
        : "no project chosen — ask the user which project to use (no projects are accessible on this JPD)",
      ...(candidatesWithNames.length > 0 ? { candidates: shown.candidatesWithNames.map((p) => p.key), ...shown } : {}),
    });
  } else if (list.code === 401 || list.code === 403) {
    emit({ check: "project", status: "error", detail: `project enumeration failed: /access rejected credentials (HTTP ${list.code}). Re-run \`jf config add --interactive\`.` });
    return { exitCode: 3 };
  } else {
    emit({ check: "project", status: "ask", detail: "no project chosen — ask the user which project to use (project enumeration was not available)" });
  }
  return { exitCode: 2 };
}

if (isMainModule(import.meta.url)) {
  const result = await detectProject(process.argv[2], process.argv[3]);
  process.exitCode = result.exitCode;
}
