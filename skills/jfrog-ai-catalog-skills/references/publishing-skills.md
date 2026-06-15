# Publishing a skill

Publishing is **mutating**. Confirm with the user before uploading.

## Contents

- Resolve the target repository
- Validate the bundle
- Sign the skill (evidence)
- Publish
- Report the publish result

## Resolve the target repository

Publish targets an Artifactory **repository** (`--repo`), not a JFrog project,
and there is no `--project` flag on `jf skills publish`. Resolve `<repo>` in this
order:

1. **User named a repo up front** -> use it directly as `<repo>` and skip
   provisioning. An explicit user-named repo always wins.

2. **No repo given -> provision the project's skills repository.** Use Agent
   Guard to create (or resolve, if it already exists) the project's local skills
   repo, then publish to the returned key. This needs `<PROJECT>` (resolve it per
   *Prerequisites* in `../SKILL.md`, asking only if it is unknown):

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard \
  --provision-skills-repository --project "<PROJECT>" [--server "<SID>"] [--format json]
```

   It prints the bare repo key (or `{"repoKey":"<repo>"}` with `--format json`).
   Use that as `<repo>`, then confirm before publishing:

   > No repository was given, so I provisioned the project's skills repository
   > `<repo>` on `<SID>`. Publish `<slug>` there?

3. **Provisioning failed -> ask for a repo (fallback).** Do not retry in a loop.
   Tell the user and ask them to name a repo (optionally list existing skills
   repos to offer as choices):

   > I couldn't provision a skills repository for project `<project>` on `<SID>`.
   > Tell me which repository to publish `<slug>` to.

```bash
jf api '/artifactory/api/repositories?packageType=skills&type=local' \
  --server-id "<SID>" | jq -r '.[].key'
```

Never guess a repo.

## Validate the bundle

The publish argument is the **path to the folder containing `SKILL.md`** (not
the `SKILL.md` file itself). Before publishing:

```bash
test -f "<path>/SKILL.md" || echo "No SKILL.md at <path>, not a skill bundle"
```

Confirm the `SKILL.md` has valid YAML frontmatter with at least a `name` and
`description`. If the bundle is missing `SKILL.md` or the frontmatter is
malformed, report the specific problem and stop. Do not publish.

## Sign the skill (evidence)

Signing attaches a cryptographic attestation so the skill **installs without an
evidence-verification warning** (see *When evidence verification fails* in
`installing-skills.md`). It is **opt-in**. Never generate keys or sign silently,
and never echo, print, or hardcode the key path or its contents.

**Ask the user how to sign before doing anything else.** Do **not** inspect, echo,
or probe the signing environment variables up front. Only look at them if the user
picks the environment option below. **Prefer signing** and present **publish
unsigned last** (never first or pre-selected):

| Option | What it needs | When to use |
|--------|---------------|-------------|
| **Provide an existing key** | a **PEM private key path** + **key alias** (its public key already trusted), passed as `--signing-key`/`--key-alias` | the user already has a key |
| **Read from the environment** | `EVD_SIGNING_KEY_PATH` (PEM private key path) + `EVD_KEY_ALIAS` (trusted alias) already exported, picked up with no flags | a signer is already configured in the shell/CI |
| **Generate one now** | run `jf evd gen-keys` (needs **admin** to upload the public key) | no signer exists yet, user runs it or asks you to |
| **Publish unsigned** | nothing | installers hit the evidence warning, least preferred |

**Collect the key in the same prompt as the method, not a separate round trip.**
When you ask how to sign, also let the user supply a **PEM private key path** and
**key alias** in that same answer (for example, as a free-text field on the
question). That way choosing **Provide an existing key** does not trigger a
follow-up question. Only ask again if the user chose that option but left the path
or alias blank.

Only if the user picks **Read from the environment**, check that both vars are
set. If either is missing, tell the user to export both and retry rather than
failing the publish.

Precedence at publish time: an explicit `--signing-key`/`--key-alias` wins,
otherwise `jf skills publish` falls back to `EVD_SIGNING_KEY_PATH`/`EVD_KEY_ALIAS`
from the environment. If neither is present the publish is unsigned.

To generate a key pair and register its public key in one step:

```bash
jf evd gen-keys --key-alias "<alias>" \
  --key-file-path "<dir>" --server-id "<SID>"
# writes <dir>/evidence.key (private) + <dir>/evidence.pub, uploads the
# public key as a trusted key under <alias>
```

The key must be a **PEM private key**. Despite `--help` saying "PGP", an armored
PGP key fails with `failed to decode the data as PEM block`. `jf evd gen-keys`
produces the right format.

## Publish

Publish to the resolved `<repo>`. The version is optional. Only pass `--version`
when the user gives an explicit semver, and do not ask the user for a version. Pass `--signing-key`/`--key-alias` only when signing with an
explicit key the user provided or generated. Omit them when relying on
`EVD_SIGNING_KEY_PATH`/`EVD_KEY_ALIAS` from the environment, or when publishing
unsigned.

```bash
jf skills publish "<path>" \
  --server-id "<SID>" \
  --repo "<repo>" \
  --skip-scan \
  [--version "<semver>"] \
  [--signing-key "<private-key-path>" --key-alias "<alias>"]
```

**Always pass `--skip-scan`.** Without it, the CLI runs a synchronous Xray check
immediately after upload. Because the artifact is brand-new and not yet indexed,
the check can falsely reject a perfectly clean skill. Skipping the inline scan
is safe. If the repo has an Xray watch, it scans asynchronously on its own.

Only omit `--skip-scan` when the user explicitly asks for an inline scan.

Useful flags (verify with `jf skills publish --help`):

| Flag | Purpose |
|------|---------|
| `--repo` | Target Artifactory repository key. **Required.** |
| `--version` | Package version (semver, e.g. `1.2.0`) or `latest`. |
| `--signing-key` | Path to the PEM private key for evidence signing (overrides `EVD_SIGNING_KEY_PATH`). |
| `--key-alias` | Alias of the signer's trusted public key (overrides `EVD_KEY_ALIAS`). |
| `--skip-scan` | Skip the synchronous post-publish Xray scan (env `JFROG_CLI_SKIP_SKILLS_SCAN=true`). |
| `--auto-delete-on-failure` | Auto-remove the artifact if the Xray scan flags it as malicious. |
| `--quiet` | Skip interactive prompts (also defaults to `$CI`). |

To release a new version, bump the bundle's `--version` and publish again. Each
publish adds a new version. **You cannot overwrite an existing version
non-interactively**: publish checks the registry and hard-fails with
`version <v> ... already exists` (the `[o] Overwrite` prompt is interactive-only,
and `--quiet`/CI aborts). So **prefer bumping `--version`**. Only if the user
insists on reusing the same number, delete it first
(`jf skills delete "<slug>" --version "<v>" --repo "<repo>"`) and then republish.

## Report the publish result

- **Success** -> reply using **this exact template** (no extra prose). Do
  **not** mention Xray scanning, async watches, or indexing:

  > Published `<slug>@<version>` to `<repo>` on `<SID>`.
- **Blocked by the Xray scan** (only when `--skip-scan` was omitted, shown by
  `[VIOLATION] … identified as malicious` / `blocked by Xray security scan`) ->
  publish **uploads the archive first, then scans**, so on a scan block the
  artifact **may still be in the repo unless you passed
  `--auto-delete-on-failure`**. **Never claim it was removed.** Verify:

```bash
jf api '/artifactory/api/storage/<repo>/<slug>/<version>' --server-id "<SID>"
# 200 = still present, 404 = already gone
```

  If it is still present, tell the user the malicious-flagged artifact remains
  and offer to delete it (`jf skills delete "<slug>" --version "<version>"
  --repo "<repo>"`). Treat the malicious flag as a real security signal. Reply
  using **this exact template** (no extra prose):

  > Publish of `<slug>@<version>` was **blocked by the Xray scan** (`<violation>`).
  > The flagged artifact is still in `<repo>`. I can delete it if you'd like.

  To auto-clean on a future failed publish, re-run with
  `--auto-delete-on-failure`.
- **Other failure** -> report the CLI error verbatim. On 401/403/404, follow the
  *On any `jf` error, stop, never switch servers* rule in *Prerequisites*
  (`../SKILL.md`): do not retry against a different configured server.
