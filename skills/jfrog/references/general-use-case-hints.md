# Use-case hints (living log)

Symptoms, causes, and mitigations discovered while using this skill on real
tasks. **Append** a new row when you confirm a novel issue (any product or
workflow). Keep entries short and actionable.

| Area | Symptom | Cause | Mitigation | Notes |
|------|---------|-------|------------|-------|
| Agent sandbox | `check-environment.sh` fails with permission denied on `local-cache/` | Cache refresh tries to write `jfrog-skill-state.json` under `<skill_path>/local-cache`; sandbox blocks workspace writes | Run with permissions that allow writing the skill's `local-cache` directory, not only `full_network` | The script does not call your JFrog server but may contact `releases.jfrog.io` for version checking |
| Parallel I/O | JSONL or ndjson parse errors ("Extra data", merged objects on one line) | Concurrent unsynchronized `>>` to the same file from parallel jobs | Sequential writes, one file per worker then `cat`, or `flock` | Generic pattern for any bulk CLI output |
| APIs (general) | Report or script missing fields that appear in the UI or docs | List endpoint omitted fields; detail GET has the full record | List then GET by id/key when needed; see `general-bulk-operations-and-agent-patterns.md` | Applies across products |
| Access / Projects | Project groups list looks empty in code | Response may use `members` for the group entries, not `groups` | Accept both keys when parsing | See `projects-api.md` |
| Bulk detail fetches | `jq` parse error ("Extra data" or "Invalid ...") on slurped detail array | One or more detail GETs returned empty/HTML/error body; `jq -s` chokes on non-JSON mixed in | Validate each response with `jq -e .` before appending; write error placeholder for failures; see `general-bulk-operations-and-agent-patterns.md` | Applies to any per-item loop (repos, builds, users) |
| Agent timeouts | Shell job silently moves to background; no captured output | `block_until_ms` too low for N sequential API calls (~1-2s each) | Estimate `N * 1.5s + 30s` buffer; set `block_until_ms` accordingly; or use parallel execution | Default 30s insufficient for >20 items |
| Sandbox + workspace writes | Generated report JSON or HTML not written; script exits 0 but file missing | Sandbox blocks some paths; agents sometimes wrongly target `local-cache/` for scratch files (disallowed — only state + schema belong there) | Write reports and API responses under `/tmp` or the user workspace; use `required_permissions: ["all"]` only when you must write inside the skill tree for the two allowed cache files | `local-cache/` is not a temp directory; see SKILL.md **`local-cache/` — allowed files only** |
| `jf api` and redirects | Responses are empty or contain redirect HTML instead of expected content | `jf api` does not expose `-L`; it follows the redirect chain the Artifactory REST API returns by default but will not transparently hop across an unexpected 3xx to a binary URL | For remote-repo artifact content (e.g. fetching a file via `/artifactory/<repo>/<path>`), use `jf rt dl` instead of `jf api` — it handles 302s to CDN hosts. Reserve `jf api` for REST metadata/operation endpoints. | Applies when reading artifact **content**, not REST metadata |
| Curation testing | `jf curation-audit` or `jf npm install` through a curated remote shows 1 download for the tested package even though no user downloaded it | The curation test itself fetches the package through Artifactory, which creates a cache entry and increments download stats | Account for this in download history analysis — the download was the curation test, not a real consumer pull | Also applies to `jf npmc` + `jf npm install` flows |
| Agent-invented mutations | Agent copies or moves artifacts into a local repo to satisfy a precondition for a different operation (e.g., copy a package so evidence can be created on it) | Requested operation failed because the artifact was not in the specified repo; agent autonomously performed a copy/move/upload to "fix" the gap | **Never** perform unrequested copy, move, upload, or create-repo to work around a failed precondition — stop and report the gap to the user. See SKILL.md § Cautious execution rule 6 | Copying into a local repo can silently change virtual repo resolution for all consumers, trigger replication, and affect Xray indexing |

## How to extend this file

1. Reproduce the issue once on a real server or fixture.
2. Add one table row (or a short new subsection if the table is a poor fit).
3. Prefer general wording so the next use case on a different product still benefits.
4. Before appending, scan existing entries for duplicates or near-duplicates —
   update the existing row instead of adding a new one.
5. Keep this file under 80 rows. If it grows beyond that, consolidate related
   entries or promote recurring patterns into the relevant reference file.
