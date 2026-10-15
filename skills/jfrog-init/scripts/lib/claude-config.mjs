// claude-config.mjs — declares the marketplace in Claude Code's own config with a
// headersHelper, so Claude Code asks for the token per request and none is stored.

import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// `null` raw means the file did not exist, so a restore removes it.
function readConfig(file) {
  let raw = null;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  let config = {};
  if (raw !== null) {
    try {
      config = JSON.parse(raw);
    } catch {
      // The parse error quotes a slice of the file, which may hold a token.
      throw new Error(`${file} is not valid JSON`);
    }
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`${file} is not a JSON object`);
  return { file, raw, config };
}

// Atomic, and keeps any symlink and the file's mode: settings.json may hold the
// user's own secrets.
function replaceFile(file, content) {
  let target = file;
  let mode;
  try {
    target = realpathSync(file);
    mode = statSync(target).mode & 0o777;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    mkdirSync(dirname(file), { recursive: true });
  }
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, content, { mode: mode ?? 0o644, flag: "wx" });
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Returns the files it could not put back, so the caller can say so.
function restore(files) {
  const failed = [];
  for (const { file, raw } of files) {
    try {
      if (raw === null) rmSync(file, { force: true });
      else replaceFile(file, raw);
    } catch {
      // One file that cannot be put back must not keep the other from it.
      failed.push(file);
    }
  }
  return failed;
}

export const MARKETPLACE_PATH = "/ml/core/api/v1/ai-registry/agent-plugins/custom/marketplace/claude-marketplace.json";

// Only a JFrog marketplace URL entry may be replaced (on this or another JPD, so
// a re-run against a new server re-points it), never another source that
// happens to share the catalog's name.
function sameMarketplace(existing, source) {
  if (existing === undefined) return true;
  try {
    const was = new URL(existing.source.url);
    return existing.source.source === "url" && was.pathname.endsWith(MARKETPLACE_PATH);
  } catch {
    return false;
  }
}

// Earlier runs stored the token as URL userinfo or an Authorization header,
// maybe under another key (an older catalog name), so every JFrog marketplace
// entry loses it, not only the one being declared. One on the declared JPD gets
// its headersHelper instead, so it can still log in; one on another JPD does
// not, since the helper would send this server's token there.
function scrubToken(entry, declared) {
  const source = entry?.source;
  if (source?.source !== "url" || typeof source.url !== "string") return;
  let url;
  try {
    url = new URL(source.url);
  } catch {
    return;
  }
  if (!url.pathname.endsWith(MARKETPLACE_PATH)) return;
  if (url.username || url.password) {
    url.username = "";
    url.password = "";
    source.url = url.toString();
  }
  if (source.headers && typeof source.headers === "object") {
    for (const key of Object.keys(source.headers)) {
      if (key.toLowerCase() === "authorization") delete source.headers[key];
    }
    if (Object.keys(source.headers).length === 0) delete source.headers;
  }
  if (url.origin === new URL(declared.url).origin) source.headersHelper ??= declared.headersHelper;
}

// The same two entries `claude plugin marketplace add` writes: its fetch cache,
// which `marketplace update` refreshes, and the user-settings declaration.
// No CLI flag sets a headersHelper, so they are written here, before `claude` runs.
// `source` replaces the old one whole, so a token header an earlier run left goes.
export function declareMarketplace(name, source) {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  let files;
  try {
    files = [readConfig(join(dir, "plugins", "known_marketplaces.json")), readConfig(join(dir, "settings.json"))];
  } catch (err) {
    return { ok: false, error: `could not read Claude Code's config: ${err.message}` };
  }
  const [cache, settings] = files;
  // The helper is kept in settings.json too, because Claude Code re-syncs the
  // cache from that declaration.
  const declared = settings.config;
  const existing = [cache.config[name], declared.extraKnownMarketplaces?.[name], declared.additionalMarketplaces?.[name]];
  if (!existing.every((entry) => sameMarketplace(entry, source))) {
    return { ok: false, error: `a different marketplace named '${name}' is already registered with Claude Code; run \`claude plugin marketplace remove ${name}\` and retry` };
  }
  // known_marketplaces.json is Claude Code's internal format: its docs name the
  // file but not its schema. This shape was checked against Claude Code 2.1.295.
  cache.config[name] = {
    installLocation: join(dir, "plugins", "marketplaces", name),
    lastUpdated: new Date(0).toISOString(),
    ...cache.config[name],
    source,
  };
  declared.extraKnownMarketplaces = {
    ...declared.extraKnownMarketplaces,
    [name]: { ...declared.extraKnownMarketplaces?.[name], source },
  };
  // claude reads marketplaces under either key, so a stale copy there would win.
  if (declared.additionalMarketplaces?.[name]) {
    declared.additionalMarketplaces[name] = { ...declared.additionalMarketplaces[name], source };
  }
  for (const map of [cache.config, declared.extraKnownMarketplaces, declared.additionalMarketplaces]) {
    for (const [key, entry] of Object.entries(map || {})) {
      if (key !== name) scrubToken(entry, source);
    }
  }

  const written = [];
  try {
    for (const entry of files) {
      replaceFile(entry.file, `${JSON.stringify(entry.config, null, 2)}\n`);
      written.push(entry);
    }
  } catch (err) {
    restore(written);
    return { ok: false, error: `could not write Claude Code's config: ${err.message}` };
  }
  return { ok: true, restore: () => restore(files) };
}
