# JFrog CLI Install & Upgrade

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
