# CLI command discovery

> **Tier B MUST** when discovery beyond `--help` is needed. Not every CLI / setup.

Use `--help` to verify uncertain options. Do not rely on memorized commands
outside this skill — they may be outdated.

1. `jf --help` — namespaces and top-level commands
2. `jf <namespace> --help` — subcommands in a namespace
3. `jf <command> --help` — usage, arguments, options

## CLI namespaces

| Namespace | Alias | Product |
|-----------|-------|---------|
| `rt` | | Artifactory |
| `xr` | | Xray |
| `ds` | | Distribution V1 |
| `at` | `apptrust` | AppTrust |
| `evd` | | Evidence |
| `mc` | | Mission Control |
| `worker` | | Workers |
| `config` | `c` | CLI server configuration |
| `plugin` | | CLI plugin management |
| `ide` | | IDE integration |

> **Sunset notice:** JFrog Pipelines has been sunset and is no longer supported.
> Do not use the `pl` CLI namespace or the Pipelines REST API
> (`/pipelines/api/...`). If a user asks about Pipelines, inform them the
> product has been sunset.

Top-level lifecycle commands (no namespace): `rbc`, `rbp`, `rbd`, `rba`,
`rbf`, `rbe`, `rbi`, `rbs`, `rbu`, `rbdell`, `rbdelr`.

Top-level security commands: `audit`, `scan`, `build-scan`, `curation-audit`,
`sbom-enrich`.

Top-level other: `access-token-create` (`atc`), `login`, `how`, `stats`,
`generate-summary-markdown`, `exchange-oidc-token`, `completion`.
