# JFrog CLI Install & Upgrade

## Minimum version for skills

Skills that call `jf api` require JFrog CLI **2.100.0** or later. On an older CLI
`jf api` is an unknown command, so the login flow stops as a prerequisite failure
rather than reaching the platform. Web login itself needs **2.86.0** or later.

Check with `jf --version`, and upgrade below that floor using the steps below.

## Installing the JFrog CLI

If `jf` is not installed (environment check exits with code 2), guide the user:

```bash
# macOS
brew install jfrog-cli

# Linux / generic
curl -fL https://install-cli.jfrog.io | sh
```

After installation, run `jf --version` to confirm and refresh the cache.

## Upgrading the JFrog CLI

If the environment check reports a newer version is available, inform the user
and offer to upgrade:

```bash
# macOS
brew upgrade jfrog-cli

# Linux / generic (reinstall)
curl -fL https://install-cli.jfrog.io | sh
```

After upgrading, run `jf --version` to confirm and refresh the cache.
