# JFrog CLI Install & Upgrade

## Minimum version for skills

Skills that call `jf api` need JFrog CLI **2.100.0** or later; on an older CLI
`jf api` is an unknown command and the login flow stops. Web login itself needs
**2.86.0** or later. Check with `jf --version`; upgrade below that floor.

## Installing the JFrog CLI

If `jf` is missing (environment check exit 2), guide the user:

```bash
# macOS
brew install jfrog-cli

# Linux / generic
curl -fL https://install-cli.jfrog.io | sh
```

Then run `jf --version` and
`node <skill_path>/scripts/check-environment.mjs <model-slug> --force` (no Node:
`bash …/check-environment.sh <model-slug> --force`).

## Upgrading the JFrog CLI

On `NEWER_AVAILABLE`, run
`node <skill_path>/scripts/cli-newer-version-offer.mjs --clear` (no Node 18+:
`bash …/cli-newer-version-offer.sh --clear`) immediately.
Never interrupt: finish the user's task first, then offer the upgrade as the
last line of the reply. Upgrade only after the user says Yes:

```bash
# macOS
brew upgrade jfrog-cli

# Linux / generic
curl -fL https://install-cli.jfrog.io | sh
```

Then run `jf --version` and
`node <skill_path>/scripts/check-environment.mjs <model-slug> --force` (no Node:
`bash …/check-environment.sh <model-slug> --force`).
