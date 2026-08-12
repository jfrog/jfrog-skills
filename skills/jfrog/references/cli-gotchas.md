# CLI and `jf api` gotchas

> **Tier B MUST** before `jf api` / AQL / advanced CLI I/O / MCP-via-shell.
> Not tips. Not required for every CLI / `jf setup` (use SKILL.md Tier A floor).
> Tier A bullets do **not** replace this file on Tier B paths.

Hard rules and known failure modes:

## MCP tools

- MCP tools return structured data in the tool result. Read response fields
  directly; do not pipe MCP output through shell commands or `jq`.

## CLI and `jf api`

- `jf api` requires the **product prefix** in the path. Omitting it returns
  404. See `references/jf-api.md` for the full product-prefix table.
- `jf api` writes the body (success or error JSON) to **stdout** and
  `[Info] Http Status: NNN` to **stderr** on every call; non-2xx also exits
  1 and adds `[Warn] jf api: <method> <url> returned NNN`. Pipe stdout to
  `jq` directly; **never `2>&1 | jq`** — stderr corrupts the JSON. To keep
  diagnostics: `jf api <path> 2>/tmp/err-$$.log | jq .`.
- `jf api` has **no `-L`** (follow redirects) and **no `-o`** (output file).
  Save bodies with shell redirection
  (`jf api ... > /tmp/out-$$.json`); for
  binary downloads through the Artifactory remote proxy prefer `jf rt dl`,
  which handles the cache and redirect semantics natively.
- Remote repository content is stored in a `-cache` suffixed repo. Properties
  and AQL queries for remote repo artifacts must target the cache repo.
  Conversely, `/api/repositories/<key>` only accepts the parent remote key
  (without `-cache`) — strip the suffix for configuration lookups.
- **Do not use `jf rt search`** — always use a direct AQL query via
  `jf api /artifactory/api/search/aql -X POST -H "Content-Type: text/plain" -d '<aql>'`.
  See `references/artifactory-aql-syntax.md`.
- Use `--quiet` flag for non-interactive execution (suppresses confirmation
  prompts). **Caution:** `--quiet` is not a global flag — commands that do not
  support it (e.g. `jf rt s`, `jf rt ping`) will fail with misleading errors
  like "Wrong number of arguments" or "flag provided but not defined". Check
  `--help` for a command before adding `--quiet`.
- Use `--server-id` when targeting a non-default server. If a command fails
  with `--server-id`, do not retry without it — that silently targets the
  default server instead. See `SKILL.md` → Server selection rules.
- Never use interactive commands. All JFrog CLI operations must be performed
  non-interactively. Known interactive commands to avoid: `jf config add`,
  `jf login`, `jf rt repo-template`, `jf rt permission-target-template`, and
  `jf rt replication-template`. For server setup, follow `references/jfrog-login-flow.md`.
  For templates, use JSON schemas or REST API. If a command prompts for input
  unexpectedly, find the non-interactive alternative via `--help` or REST API.
- `jf config export` output is base64-encoded JSON. Decode with
  `base64 -d | jq` to extract fields.
- Build info lookups require a scope (`?buildRepo=` or `?project=`) —
  resolve it before calling the API. See `references/artifactory-operations.md`
  §Retrieving build info for the full workflow.
- If a `jf api` call returns 401, the configured token may have expired or
  been rotated — ask the user to re-run the login flow (see
  `references/jfrog-login-flow.md`) for the **same** server. If 403, the
  token lacks required permissions. If 404, verify the endpoint path
  (especially the product prefix) and target server version. On any of
  these errors, do not try a different configured server as a workaround —
  that targets a different environment. Report the error and ask the user.
- **Xray contextual analysis:** the summary artifact response has two
  applicability fields — `applicability` (top-level, often null) and
  `applicability_details` (always present with a `result` string). **Use
  `applicability_details[].result` for counts and summaries.** Using the
  top-level `applicability` field for aggregation produces wrong counts because
  it is null when no scanner exists. See `references/xray-entities.md`
  §Contextual analysis for the eight possible result values and jq snippets.
- **OneModel GraphQL:** always fetch the supergraph schema from the **same**
  server you query before building operations (schemas differ by deployment);
  cache, validate, and execute per `references/onemodel-graphql.md`.
- Never duplicate a network-fetching command to retry `jq` parsing — save the
  response to a temp file first (see `references/preserving-command-output.md`).
- When collecting detail responses in a loop (e.g. per-repo GETs), validate
  each body with `jq -e .` before appending to a results file. One non-JSON
  or empty response corrupts a downstream `jq -s` slurp. Write validated
  lines to an NDJSON file, then `jq -s '.' file.ndjson` to produce the final
  array. See `references/general-bulk-operations-and-agent-patterns.md`.
- Accumulated edge cases from real tasks live in `references/general-use-case-hints.md`
  — read when debugging odd failures; **append** a short entry when you confirm
  a new, reusable gotcha.
