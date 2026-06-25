# Publishing a skill

Publishing is mutating, so **always confirm the target repository and the skill
name with the user before publishing**. Resolve the repo and read the name from
the bundle, then show both and wait for an explicit "yes". Never publish on the
initial request alone, and never auto-pick a repo without surfacing it first.

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

1. **User named a repo up front.** Use it directly as `<repo>` and skip
   provisioning. An explicit user-named repo always wins.

2. **No repo given. Provision the project's skills repository.** Use Agent
   Guard to create (or resolve, if it already exists) the project's local skills
   repo, then publish to the returned key. This needs `<PROJECT>` (resolve it per
   *Prerequisites* in `../SKILL.md`, asking only if it is unknown):

```bash
npx --yes --registry <REGISTRY_URL> @jfrog/agent-guard \
  --provision-skills-repository --project "<PROJECT>" [--server "<SID>"] [--format json]
```

   It prints the bare repo key (or `{"repoKey":"<repo>"}` with `--format json`).
   Use that as `<repo>`, then **show the user the provisioned repo and the skill
   name and wait for confirmation** before publishing (see *Confirm before
   publishing*). Do not publish to it silently.

3. **Provisioning failed. Stop and ask the user which repo to use.** Do not
   retry in a loop. Publishing is mutating, so you must get an explicit repo from
   the user here. This is the one case where you do ask before publishing.

   First list the existing skills repos:

```bash
jf api '/artifactory/api/repositories?packageType=skills&type=local' \
  --server-id "<SID>" 2>/dev/null | jq -r '.[].key'
```

   Then **wait for the user to pick one** (by name). If the command printed one or
   more repos, reply in **this exact format**, sorted by name, one row per key, and
   nothing else:

   Provisioning a skills repository for project `<project>` on `<SID>` failed, so
   pick an existing repository to publish `<slug>` to:

   | Repository |
   |------------|
   | `<repo>` |

   If the command printed nothing (no skills repos on the server), reply with one
   line instead, filling `<reason>` with the provisioning error:

   > No skills repositories on `<SID>` to publish to (provisioning failed: `<reason>`). Tell me a repository to use, or ask me to retry.

   **Never auto-select a repo, even if one exists whose name matches the
   project.** A name match is not consent. Do not publish to any repo the user did
   not explicitly choose. Never guess a repo.

## Validate the bundle

The publish argument is the **path to the folder containing `SKILL.md`** (not
the `SKILL.md` file itself). Before publishing:

```bash
test -f "<path>/SKILL.md" || echo "No SKILL.md at <path>, not a skill bundle"
```

Confirm the `SKILL.md` has valid YAML frontmatter with at least a `name` and
`description`. If the bundle is missing `SKILL.md` or the frontmatter is
malformed, do not publish and reply using **this exact template** (no extra
prose), filling `<problem>` with the specific issue found:

  > `<path>` is not a publishable skill bundle: `<problem>`. Point me at the
  > folder that contains `SKILL.md` and I'll retry.

## Sign the skill (evidence)

Signing attaches a cryptographic attestation so the skill **installs without an
evidence-verification warning** (see *When evidence verification fails* in
`installing-skills.md`). It is **opt-in**. Never generate keys or sign silently,
and never echo, print, or hardcode the key path or its contents.

**Ask the user how to sign before doing anything else.** Do **not** inspect, echo,
or probe the signing environment variables up front. Only look at them if the user
picks the environment option below. Use the table below as your own reference. Do
not paste it into the chat. Ask the user to pick one option, **prefer signing**,
and keep **publish unsigned** last:

| Option | What it needs | When to use |
|--------|---------------|-------------|
| **Provide an existing key** | a **PEM private key path** + **key alias** (its public key already trusted), passed as `--signing-key`/`--key-alias` | the user already has a key |
| **Read from the environment** | `EVD_SIGNING_KEY_PATH` (PEM private key path) + `EVD_KEY_ALIAS` (trusted alias) already exported, picked up with no flags | a signer is already configured in the shell/CI |
| **Generate one now** | run `jf evd gen-keys` (needs **admin** to upload the public key) | no signer exists yet, user runs it or asks you to |
| **Publish unsigned** | nothing | installers hit the evidence warning, least preferred |

**Ask for the key in the same prompt.** Let the user give the PEM private key path
and key alias in that answer, so **Provide an existing key** needs no follow-up.
Ask again only if they picked it but left the path or alias blank.

For **Read from the environment**, check both vars are set. If either is missing,
ask the user to export both and retry instead of failing the publish.

Precedence: an explicit `--signing-key`/`--key-alias` wins. Without it,
`jf skills publish` falls back to `EVD_SIGNING_KEY_PATH`/`EVD_KEY_ALIAS`. With
neither, the publish is unsigned.

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

## Confirm before publishing

Once `<repo>` is resolved and the bundle validated, **show the user what will be
published and wait for an explicit confirmation**. Reply using this exact
template and do not run `jf skills publish` until the user agrees:

  > Publishing skill `<slug>` uploads it to repository `<repo>` on server `<SID>`. Do you want to publish it?

If the user says no or names a different repo/name, use that instead and confirm
again. Only proceed to *Publish* after an explicit "yes".

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
  --quiet \
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
publish adds a new version.

**On a version conflict** (publish fails with `version <v> ... already exists`):
the CLI's `[o] Overwrite` prompt is interactive-only (`--quiet`/CI aborts), so it
cannot be answered from here. Use the table below as your own reference. Do not
paste it into the chat. Ask the user to pick one option, filling `<v>` with the
existing version and `<next>` with the next patch (for example `3.0.0` to `3.0.1`):

| Option | Action |
|--------|--------|
| **Overwrite** | Run `jf skills delete "<slug>" --version "<v>" --repo "<repo>" --server-id "<SID>"`, then re-run the publish unchanged. |
| **Publish as a new version** | Re-run the publish with `--version <new>` (the user's semver, or `<next>`). |
| **Abort** | Stop and report that nothing was published. |

## Report the publish result

- **Success.** Reply using **this exact template**. Do not mention Xray
  scanning, async watches, or indexing:

  > Published `<slug>@<version>` to `<repo>` on `<SID>`.
- **Blocked by the Xray scan** (only when `--skip-scan` was omitted, shown by
  `[VIOLATION] … identified as malicious` or `blocked by Xray security scan`).
  Publish uploads the archive first, then scans, so on a scan block the artifact
  may still be in the repo unless you passed `--auto-delete-on-failure`. Never
  claim it was removed. Verify:

```bash
jf api '/artifactory/api/storage/<repo>/<slug>/<version>' --server-id "<SID>"
# 200 = still present, 404 = already gone
```

  If it is still present, tell the user the malicious-flagged artifact remains
  and offer to delete it (`jf skills delete "<slug>" --version "<version>"
  --repo "<repo>" --server-id "<SID>"`). Treat the malicious flag as a real security signal. Reply
  using **this exact template**:

  > Publish of `<slug>@<version>` was **blocked by the Xray scan** (`<violation>`).
  > The flagged artifact is still in `<repo>`. I can delete it if you'd like.

  To auto-clean on a future failed publish, re-run with
  `--auto-delete-on-failure`.
- **Other failure.** Reply using **this exact template**, quoting the CLI error
  verbatim in `<cli-error>`:

  > Publishing `<slug>` to `<repo>` on `<SID>` failed: `<cli-error>`.

  On 401/403/404, follow the stop-on-error rule from the base `jfrog` skill
  (see *Prerequisites* in `../SKILL.md`): stop and do not retry against a
  different configured server.
