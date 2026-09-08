#!/usr/bin/env node
// Checks ~/.local/share/opencode/mcp-auth.json for a completed jfrog OAuth
// token (tokens.accessToken non-empty). Read-only — never runs the interactive
// `opencode mcp auth jfrog` command itself. OpenCode-only; other harnesses
// use agent-guard, which reads jf config credentials directly.
//
// Path and shape are reverse-engineered from a real OpenCode install, not
// its source — a future restructure would silently read as "not authenticated".
//
// Exit 0 -> green (tokens.accessToken present)
// Exit 1 -> red   (file/entry missing, or OAuth flow started but not finished)
// Exit 3 -> error (file unreadable or not valid JSON)

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { emit as emitJf, isMainModule } from "./lib/jf.mjs";

export function resolveOpencodeMcpAuthPath() {
  const dataBase = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(dataBase, "opencode", "mcp-auth.json");
}

function emit(status, file, detail) {
  emitJf({ check: "opencode-mcp-auth", status, file, detail });
}

export function detectOpencodeMcpAuth() {
  const target = resolveOpencodeMcpAuthPath();

  let size;
  try { size = statSync(target).size; } catch (err) {
    if (err.code !== "ENOENT") {
      emit("error", target, `could not stat ${target}: ${err.message}`);
      return 3;
    }
    size = 0;
  }
  if (size === 0) {
    emit("red", target, "no OpenCode MCP auth store yet — run `opencode mcp auth jfrog`");
    return 1;
  }

  let raw;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    emit("error", target, `could not read ${target}: ${err.message}`);
    return 3;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    emit("error", target, `${target} is not valid JSON`);
    return 3;
  }

  // A jfrog key with only PKCE state (clientInfo, codeVerifier, oauthState)
  // means OAuth was started but never completed — only tokens.accessToken
  // being non-empty means the handshake actually finished.
  const entry = parsed?.jfrog;
  const accessToken = entry !== null && typeof entry === "object" ? entry?.tokens?.accessToken : undefined;
  const hasToken = typeof accessToken === "string" && accessToken.trim() !== "";
  if (!hasToken) {
    const detail =
      entry !== null && typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).length > 0
        ? "jfrog entry exists but has no access token (OAuth flow started but never completed) — run `opencode mcp auth jfrog`"
        : "no jfrog entry in OpenCode MCP auth store — run `opencode mcp auth jfrog`";
    emit("red", target, detail);
    return 1;
  }

  emit("green", target, "OpenCode MCP auth store has a jfrog access token");
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = detectOpencodeMcpAuth();
}
