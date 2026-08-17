#!/usr/bin/env node
// Resolves and validates the project key for the walk. The picked value is
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
// Resolution — matches BOTH project_key and display_name (case-
// insensitive; see lib/projects.mjs for the exact tier order). Never
// guesses, never assumes "default", never invents a value.
//
// The enumeration call is cached per server for a few minutes (see
// lib/project-cache.mjs) — the caller re-invokes this script once per
// user attempt within a single walk, and matching is offline anyway,
// so only the first attempt actually hits the network.
//
// Usage: node jfrog-detect-project.mjs [server-id] [project-input]
//
// Every non-green result also carries `candidatesWithNames` (up to the
// full enumerated project list, `{key, displayName}`, sorted) whenever
// enumeration succeeded, so the caller can offer the first two as an
// interactive pick-one-or-type-your-own prompt instead of demanding the
// user type a key or name from memory. A confirmed-not-found input (404)
// additionally carries `similarProjects` — up to 2 "did you mean...?"
// suggestions (see lib/projects.mjs) — when the typed input looks like a
// near-miss of an existing project (e.g. "widgets20" when "widgets2" exists).
//
// Exit 0 -> green (project exists and is accessible; resolved canonical key in detail)
// Exit 1 -> red   (project does not exist, no access, ambiguous match, or a
//                  5xx from the existence probe — the backend is erroring
//                  — or the probe could not connect at all. The last two
//                  are indistinguishable from here, so they share a
//                  classification, the same way
//                  jfrog-detect-catalog-runtime.mjs treats its own "000".)
// Exit 2 -> ask   (no input passed, or multiple jf servers configured with none
//                  resolvable — caller must prompt the user and re-invoke)
// Exit 3 -> error (jf missing, credentials unavailable/rejected, an
//                  unexpected non-5xx HTTP code, or a 2xx response that
//                  wasn't shaped like the real GetProject endpoint)

import { emit, isMainModule, resolveCreds, authedFetch, NETWORK_UNREACHABLE_HINT } from "./lib/jf.mjs";
import { resolveServerOrEmit } from "./jfrog-resolve-jf-server.mjs";
import { resolveProject, projectsWithNames, findSimilarProjects, capCandidatesForDisplay } from "./lib/projects.mjs";
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
  const projectInput = projectInputArg || "";

  const creds = resolveCreds(serverId);
  if (!creds) {
    emit({
      check: "project",
      status: "error",
      detail: "cannot authenticate to /access: no access token or user+password found in jf config. Re-run `jf config add --interactive`.",
    });
    return { exitCode: 3 };
  }

  const rawGet = (path) => authedFetch(creds, path);

  // ---------- Fetch project list first (needed for every branch) ----------
  // Cached per server for a short TTL (lib/project-cache.mjs): the
  // interactive picker re-invokes this script once per user attempt within
  // the same walk, and re-enumerating on every typed guess is wasted
  // network traffic — matching/similarity search below already runs
  // offline against whatever list we have in memory.
  let list;
  const cachedBody = readCachedProjectList(serverId, creds);
  if (cachedBody !== null) {
    list = { code: 200, body: cachedBody };
  } else {
    list = await rawGet("/access/api/v1/projects");
    if (list.code >= 200 && list.code < 300) writeCachedProjectList(serverId, creds, list.body);
  }
  const enumOk = list.code >= 200 && list.code < 300;
  const candidatesWithNames = enumOk ? projectsWithNames(list.body) : [];

  // ---------- Resolve+validate branch: an input was passed ----------
  if (projectInput) {
    let resolvedKey = projectInput;
    if (enumOk) {
      const resolved = resolveProject(candidatesWithNames, projectInput);
      if (resolved?.tied) {
        emit({
          check: "project",
          status: "red",
          detail: `input "${projectInput}" matches multiple projects; be more specific`,
          candidates: resolved.tied,
          ...capCandidatesForDisplay(candidatesWithNames),
        });
        return { exitCode: 1 };
      }
      if (resolved?.key) resolvedKey = resolved.key;
      // No match against the enumeration — could still be a valid key the
      // enumeration missed (paging, ACL), so let the existence probe below
      // be the ultimate arbiter.
    }

    // Encode as a single path segment (not just URI-escape) so an input like
    // "../projects" can't change which endpoint gets hit.
    const projectPath = `/access/api/v1/projects/${encodeURIComponent(resolvedKey)}`;
    const probe = await rawGet(projectPath);
    // A 2xx status alone isn't proof this is really the GetProject response —
    // a captive portal or misrouted network can also answer 200. Require the
    // expected shape (an object carrying the project's own key) too, the
    // same guard jfrog-detect-catalog-runtime.mjs applies to its endpoint.
    const looksLikeProject =
      probe.body &&
      typeof probe.body === "object" &&
      (typeof probe.body.project_key === "string" || typeof probe.body.projectKey === "string");
    if (probe.code >= 200 && probe.code < 300 && looksLikeProject) {
      emit({ check: "project", status: "green", detail: `project ${resolvedKey} exists and is accessible (HTTP ${probe.code})`, resolvedKey });
      return { exitCode: 0, resolvedKey };
    }
    if (probe.code >= 200 && probe.code < 300 && !looksLikeProject) {
      emit({
        check: "project",
        status: "error",
        detail: `got HTTP ${probe.code} from ${creds.baseUrl}${projectPath} but the response wasn't the expected project shape — this may not be the JPD's real endpoint (captive portal / proxy?)`,
      });
      return { exitCode: 3 };
    }
    if (probe.code >= 500 && probe.code < 600) {
      // A 5xx means the backend itself is erroring, same as a connection
      // failure from the caller's perspective — treat it as "red", not
      // "error", matching jfrog-detect-catalog-runtime.mjs and
      // jfrog-detect-server-ping.mjs's classification of the same code class.
      emit({ check: "project", status: "red", detail: `${creds.baseUrl}${projectPath} returned HTTP ${probe.code} — the backend is erroring` });
      return { exitCode: 1 };
    }
    if (probe.code === 404) {
      const similarProjects = enumOk ? findSimilarProjects(candidatesWithNames, projectInput) : [];
      emit({
        check: "project",
        status: "red",
        detail: `no project matches "${projectInput}" on this JPD — pick a different one`,
        resolvedKey,
        ...capCandidatesForDisplay(candidatesWithNames),
        ...(similarProjects.length > 0 ? { similarProjects } : {}),
      });
      return { exitCode: 1 };
    }
    if (probe.code === 401) {
      // Unlike 403, a 401 means the credentials themselves were rejected —
      // this says nothing about whether the project exists.
      emit({
        check: "project",
        status: "error",
        detail: `cannot verify project ${resolvedKey}: /access rejected the credentials in jf config (HTTP 401). Re-run \`jf config add --interactive\`.`,
      });
      return { exitCode: 3 };
    }
    if (probe.code === 403) {
      // ACLs are per-project — not entitled to this one says nothing about
      // any other, so carry candidatesWithNames the same as the 404 branch
      // to let the caller re-offer the picker instead of dead-ending.
      emit({
        check: "project",
        status: "red",
        detail: `project ${resolvedKey} exists but your user is not entitled to see it (HTTP 403) — pick a project you have access to, or contact your JFrog admin`,
        ...capCandidatesForDisplay(candidatesWithNames),
      });
      return { exitCode: 1 };
    }
    if (probe.code === 0) {
      // Red, not error — the 5xx branch above treats "the backend is
      // erroring" as red precisely because it's indistinguishable from a
      // connection failure from here, and
      // jfrog-detect-catalog-runtime.mjs maps its own "000" to red too.
      // Classifying the real thing as an error would make the same
      // condition blocking in Step 6 and non-blocking in Step 7.
      emit({
        check: "project",
        status: "red",
        detail: `could not reach ${creds.baseUrl}${projectPath} (connection failed)${NETWORK_UNREACHABLE_HINT}`,
        ...capCandidatesForDisplay(candidatesWithNames),
      });
      return { exitCode: 1 };
    }
    emit({ check: "project", status: "error", detail: `project validation returned unexpected HTTP ${probe.code} for ${creds.baseUrl}${projectPath}` });
    return { exitCode: 3 };
  }

  // ---------- Ask branch: no input passed; return candidates ----------
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
  } else {
    emit({ check: "project", status: "ask", detail: "no project chosen — ask the user which project to use (project enumeration was not available)" });
  }
  return { exitCode: 2 };
}

if (isMainModule(import.meta.url)) {
  const result = await detectProject(process.argv[2], process.argv[3]);
  process.exitCode = result.exitCode;
}
