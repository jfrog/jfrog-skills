// projects.mjs — resolves a user-typed project name-or-key against a
// GetProjectsList response (https://docs.jfrog.com/projects/reference/getprojectslist),
// which returns either a bare array of project objects or `{"projects": [...]}`,
// each with `project_key`/`projectKey` and `display_name`/`displayName`.

function extractList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.projects)) return data.projects;
  return [];
}

export function projectsWithNames(data) {
  const seen = new Set();
  const out = [];
  for (const p of extractList(data)) {
    if (!p || typeof p !== "object") continue;
    const key = p.project_key ?? p.projectKey;
    if (typeof key !== "string" || !key || seen.has(key)) continue;
    seen.add(key);
    const name = p.display_name ?? p.displayName;
    out.push({ key, displayName: typeof name === "string" && name ? name : key });
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

// Caps the list a detector emits back to its caller, WITHOUT touching the
// list used for matching (resolveProject()/findSimilarProjects() below still
// need the full enumeration to match correctly against any typed input, not
// just the first N). A JPD with hundreds of projects would otherwise dump
// them all into the caller's own context on every non-green result — the
// caller only ever offers the first two as picker options anyway (see
// references/project-picker.md), so anything past the cap changes nothing
// about what the user sees, only how much the caller has to read.
// `candidatesTotal` is present only when actually truncated.
export function capCandidatesForDisplay(list, limit = 20) {
  if (list.length <= limit) return { candidatesWithNames: list };
  return { candidatesWithNames: list.slice(0, limit), candidatesTotal: list.length };
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// A substring match (tiers 4/5 below, and findSimilarProjects' containment
// check) only counts if the shorter side is long enough to be meaningful —
// otherwise a short needle like "ai" or a short project key like "da"
// spuriously "matches" almost anything that happens to contain those
// characters in a row.
const MIN_SUBSTRING_LEN = 3;

// Resolves `needle` against BOTH project_key and display_name, strictest
// tier first (each tier only runs if the previous one had zero hits):
//   1. Exact key                4. Unique substring, literal
//   2. Exact display name       5. Unique substring, separator-stripped
//   3. Exact, separator-stripped ("aicatalog" == "ai_catalog" / "ai catalog")
// Returns { key } on a unique match, { tied: [...] } on an ambiguous one
// (multiple hits at the first tier that has any), or null on no match.
// Tiers 3/5 are skipped when the separator-stripped needle is empty (pure
// punctuation input), since an empty string is a substring of everything.
// Tiers 4/5 are also skipped when the needle is shorter than
// MIN_SUBSTRING_LEN, for the same reason findSimilarProjects guards its
// containment check — a short needle can substring-match multiple
// unrelated projects and get misreported as ambiguous.
//
// Takes the already-deduped/sorted `projectsWithNames()` output rather
// than raw API data — the caller already computed it once for
// `candidatesWithNames`, and re-deriving it here on every call would
// redo that dedup+sort for no benefit.
export function resolveProject(projects, needle) {
  if (!needle) return null;

  const needleLc = needle.toLowerCase();
  const needleNorm = norm(needle);

  const tiers = [
    () => projects.filter((p) => p.key.toLowerCase() === needleLc),
    () => projects.filter((p) => p.displayName.toLowerCase() === needleLc),
    () => (needleNorm ? projects.filter((p) => norm(p.key) === needleNorm || norm(p.displayName) === needleNorm) : []),
    () =>
      needleLc.length >= MIN_SUBSTRING_LEN
        ? projects.filter((p) => p.key.toLowerCase().includes(needleLc) || p.displayName.toLowerCase().includes(needleLc))
        : [],
    () =>
      needleNorm.length >= MIN_SUBSTRING_LEN
        ? projects.filter((p) => norm(p.key).includes(needleNorm) || norm(p.displayName).includes(needleNorm))
        : [],
  ];

  for (const tier of tiers) {
    const hits = tier();
    if (hits.length === 1) return { key: hits[0].key };
    if (hits.length > 1) return { tied: [...new Set(hits.map((p) => p.key))] };
  }
  return null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], row[j - 1]);
    }
    prev = row;
  }
  return prev[b.length];
}

// "Did you mean...?" suggestions for a needle that matched nothing in
// resolveProject. Ranks every project by how close it looks to the typed
// input — substring containment either direction (e.g. "widgets20" typed,
// project key "widgets2" is a prefix of it) beats edit distance, which
// catches the common case of a stray/missing/swapped character
// ("widgets20" vs "widgets2", "wdgets1" vs "widgets1"). A project only qualifies
// if it's a reasonably close typo, not just "closest of a bad lot" — pure
// edit-distance ranking with no floor would always suggest *something*,
// even for input that resembles nothing on the JPD.
//
// Takes the same already-deduped/sorted `projectsWithNames()` output as
// resolveProject() above, for the same reason — avoid a third
// re-derivation of the same list from raw API data.
export function findSimilarProjects(projects, needle, limit = 2) {
  if (!needle) return [];
  const needleLc = needle.toLowerCase();

  const containedIn = (haystack, piece) => piece.length >= MIN_SUBSTRING_LEN && haystack.includes(piece);

  const scored = projects.map((p) => {
    const keyLc = p.key.toLowerCase();
    const nameLc = p.displayName.toLowerCase();
    const contains =
      containedIn(needleLc, keyLc) ||
      containedIn(keyLc, needleLc) ||
      (nameLc && (containedIn(needleLc, nameLc) || containedIn(nameLc, needleLc)));
    // The threshold scales off whichever side (key or name) actually
    // produced the winning distance — not always the key. A short key
    // paired with a long display name would otherwise clamp the
    // threshold down to the key's tiny length even when the needle is a
    // genuinely close typo of the (much longer) name, wrongly rejecting it.
    const keyDist = levenshtein(needleLc, keyLc);
    const nameDist = nameLc ? levenshtein(needleLc, nameLc) : Infinity;
    const dist = Math.min(keyDist, nameDist);
    const winnerLen = keyDist <= nameDist ? keyLc.length : nameLc.length;
    const closeEnough = dist <= Math.max(2, Math.ceil(Math.min(needleLc.length, winnerLen) * 0.4));
    return { key: p.key, displayName: p.displayName, contains, dist, qualifies: contains || closeEnough };
  });

  return scored
    .filter((s) => s.qualifies)
    .sort((a, b) => (a.contains !== b.contains ? (a.contains ? -1 : 1) : a.dist !== b.dist ? a.dist - b.dist : a.key.localeCompare(b.key)))
    .slice(0, limit)
    .map(({ key, displayName }) => ({ key, displayName }));
}
