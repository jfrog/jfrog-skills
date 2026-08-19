// claude-config.mjs — keeps the marketplace token out of Claude Code's saved URL.

import { readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const entriesOf = (...maps) => maps.flatMap((map) => Object.values(map ?? {}));

// Both hold the token: `claude`'s fetch cache, and its settings declaration.
function marketplaceFiles() {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return [
    [join(dir, "plugins", "known_marketplaces.json"), entriesOf],
    // claude reads marketplaces under either name, so a token can sit under either key.
    [join(dir, "settings.json"), (config) => entriesOf(config.additionalMarketplaces, config.extraKnownMarketplaces)],
  ];
}

function withoutCredentials(url) {
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

// Atomic, owner-only for the token, and keeps any symlink.
function replaceFile(file, content) {
  const target = realpathSync(file);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, content, { mode: 0o600, flag: "wx" });
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Any project scope of the same marketplace, since each carries its own copy.
function moveCredentials(source, target) {
  if (source?.source !== "url") return false;
  try {
    const saved = new URL(source.url);
    if (saved.origin !== target.origin || saved.pathname !== target.pathname || !saved.password) return false;
    source.headers = { ...source.headers, Authorization: `Bearer ${decodeURIComponent(saved.password)}` };
    source.url = withoutCredentials(source.url);
    return true;
  } catch {
    // One unreadable entry must not block the rest.
    return false;
  }
}

// No CLI flag sets a header, so the entries `claude` saved are edited in place.
export function moveTokenToHeader(url) {
  const target = new URL(url);
  for (const [file, entriesIn] of marketplaceFiles()) {
    try {
      const config = JSON.parse(readFileSync(file, "utf8"));
      let moved = false;
      for (const entry of entriesIn(config)) {
        if (moveCredentials(entry?.source, target)) moved = true;
      }
      if (moved) replaceFile(file, `${JSON.stringify(config, null, 2)}\n`);
    } catch {
      // Best effort: `claude` keeps working from the URL it saved.
    }
  }
}
