# Catalog entities

When to read this file:

- Querying **public package metadata** (descriptions, vulnerabilities, licenses, operational info).
- Working with the **Custom Catalog** (org-specific labels, package views, federation).
- Looking up **vulnerability details** beyond what Xray provides (advisories, EPSS, CWE, known exploits).
- Querying **OpenSSF scorecards**, **ML model metadata**, or **MCP service** registries.
- Using the OneModel GraphQL API with `publicPackages`, `customPackages`,
  `publicSecurityInfo`, `publicLegalInfo`, `publicOperationalInfo`,
  `publicCatalogLabels`, or `publicRemoteServices` query roots.

Catalog entities are accessed via the **OneModel GraphQL API**
(`/onemodel/api/v1/graphql`).

For the OneModel query workflow (credentials, schema fetch, validation,
execution), read `references/onemodel-graphql.md`.

## Two catalog layers

| Layer | Scope | Description |
|-------|-------|-------------|
| **Public Catalog** | Global | JFrog's curated package database — security, legal, and operational metadata for public packages across ecosystems |
| **Custom Catalog** | Organization | Org-specific overlay — custom labels, per-org package views, federation config |

The Custom Catalog builds on top of the Public Catalog. A public package
can be enriched with org-specific labels and metadata through the Custom
Catalog without altering the underlying public data.

## Public Catalog entities

### PublicPackage

A package as known to JFrog's global package database.

| Field | Description |
|-------|-------------|
| `name` | Package name (e.g. `lodash`, `spring-boot-starter-web`) |
| `type` | Package type (e.g. `npm`, `maven`, `pypi`) |
| `ecosystem` | Ecosystem identifier |
| `description` | Rich-text description |
| `homepage`, `vcsUrl` | Package URLs |
| `vendor` | Maintainer or organization |
| `latestVersion` | Most recent version |
| `trendingScore` | Popularity score |
| `publishedAt`, `modifiedAt` | Timestamps |
| `mlModel` | ML model metadata (for HuggingFace etc.) |

Connections: `versionsConnection`, `publicLabelsConnection`, `legalInfo`,
`operationalInfo`, `securityInfo`.

Query: `publicPackages.searchPackages(where: {...})`.

### PublicPackageVersion

A specific version with security, legal, and operational analysis.

| Field | Description |
|-------|-------------|
| `version` | Version string |
| `isLatest` | Whether this is the latest version |
| `isListedVersion` | Whether visible in Catalog UI |
| `publishedAt`, `modifiedAt` | Timestamps |
| `trendingScore` | Version-level popularity |
| `dependencies` | Dependency information |
| `mlModelMetadata`, `mlInfo` | ML/AI-related metadata |

Each version carries three info blocks:
- `securityInfo` — vulnerability data, maliciousness, contextual analysis
- `legalInfo` — licenses, copyrights
- `operationalInfo` — end-of-life, OpenSSF scores, popularity metrics

### PublicVulnerability

Vulnerability data richer than what Xray violations expose. Useful for
deep-dive security analysis and advisory lookups.

| Field | Description |
|-------|-------------|
| `name` | CVE identifier (e.g. `CVE-2021-44228`) |
| `ecosystem` | Affected ecosystem |
| `severity` | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` |
| `description` | Detailed impact description |
| `cvss` | CVSS scores — v2, v3, **and v4** |
| `epss` | EPSS (Exploit Prediction Scoring System) — exploit likelihood |
| `knownExploit` | Known exploit information |
| `withdrawn` | Whether the CVE has been retracted |
| `aliases` | Alternative identifiers |
| `references` | Advisory URLs |
| `publishedAt`, `modifiedAt` | Timestamps |

Advisory sources (via `advisories` connection):
- **NVD** — NIST National Vulnerability Database
- **GHSA** — GitHub Security Advisory
- **JFrog Advisory** — JFrog's own research (includes impact reasons)
- **Debian Security Tracker**
- **RedHat OVAL**

Additional connections: `cwesConnection` (CWE entries), `cpesConnection`
(CPE entries), `publicPackageInfo` (affected packages and versions).

Query: `publicSecurityInfo.searchVulnerabilities(where: {...})`.

#### Filtering limitations

`searchVulnerabilities` can filter by CVE name, ecosystem, severity, CVSS,
EPSS, known exploit status, and publication date — but **not** by affected
package name. There is no `hasPublicPackageInfoWith` or similar filter on
`PublicVulnerabilityWhereInput`. To find vulnerabilities affecting a specific
package, use one of these alternatives:

- **Version-level security info** (GraphQL): query
  `publicPackages.getPackage(type, name)` and navigate to
  `versionsConnection → securityInfo → vulnerabilitiesConnection` to get
  CVEs affecting specific versions.
- **Individual CVE lookup**: use `searchVulnerabilities(where: { name: "<CVE>" })`
  and inspect `publicPackageInfo.vulnerablePublicPackagesConnection` on the
  `generic` ecosystem entry.

#### Ecosystem multiplicity

A single CVE appears as multiple `PublicVulnerability` entries — one per
ecosystem. The `ecosystem` field determines which entry you see:

| Ecosystem | Contains |
|-----------|----------|
| `generic` | Non-OS package-level data (npm, maven, pypi, go, etc.) — includes `publicPackageInfo` with vulnerable versions and fix versions |
| `debian`, `redhat`, `ubuntu`, etc. | OS-specific advisory data — severity may differ from NVD; `publicPackageInfo` is typically empty (OS packages are tracked separately) |

When looking up a CVE by name, `searchVulnerabilities(where: { name: "<CVE>" })`
returns all ecosystem entries. To get affected packages and fix versions for
libraries like npm or maven, filter for or focus on the `generic` ecosystem
entry. `getVulnerability` requires both `name` and `ecosystem` — use
`searchVulnerabilities` when the ecosystem is unknown.

### PublicLicense

License metadata with permission, condition, and limitation details.

| Field | Description |
|-------|-------------|
| `name` | License name (e.g. `Apache-2.0`, `MIT`) |
| `spdxId` | SPDX identifier |
| `permissions` | What the license permits |
| `limitations` | Restrictions imposed |
| `patentConditions` | Patent grant conditions |
| `noticeFiles` | Required notices |

Query: `publicLegalInfo.searchLicenses(where: {...})`.

### PublicPackageOperationalInfo

Operational risk assessment for packages and versions.

| Entity | Key data |
|--------|----------|
| **OpenSSF scorecard** | Overall score, individual checks with scores and pass/fail |
| **End-of-life** | Whether the package or version is EOL, justification |
| **Popularity** | JFrog popularity by segment and subscription tier, download counts |

### MCP services and tools

The Public Catalog also indexes MCP (Model Context Protocol) services:

| Entity | Description |
|--------|-------------|
| `PublicMcpService` | An MCP service with name, description, version |
| `PublicMcpTool` | A tool exposed by an MCP service with arguments |
| `PublicMcpRemote` | Remote MCP server configuration |

Query: `publicRemoteServices.searchMcpServices(where: {...})`.

## Custom Catalog entities

### CustomPackage

A package in the organization's private catalog view.

| Field | Description |
|-------|-------------|
| `customCatalogId` | Org-scoped identifier |
| `name`, `type`, `ecosystem`, `namespace` | Package identity |
| `isListedPackage` | Whether visible in Catalog UI |
| `customCatalogAddedAt`, `customCatalogModifiedAt` | Org-specific timestamps |

Connections: `versionsConnection`, `legalInfo`,
`customCatalogLabelsConnection`.

### CustomCatalogLabel

Organization-defined labels for categorizing packages.

| Field | Description |
|-------|-------------|
| `name` | Label name |
| `description` | What the label represents |
| `color` | Display color |
| `labelType` | `MANUAL` or `AUTOMATIC` |
| `assignmentInfo` | How and when the label was assigned |

Labels can be assigned to both custom packages and public packages/versions
within the org's catalog scope. The Custom Catalog mutations allow
creating, updating, and deleting labels.

### CustomCatalogFederation

Configuration for federating catalog data across JFrog deployments.

## Catalog vs. Xray vs. Stored Packages

These three domains provide different views of package and security data:

| Aspect | Catalog | Xray | Stored Packages |
|--------|---------|------|-----------------|
| **Scope** | Global knowledge base + org overlay | Instance-scoped scanning | Instance-scoped storage |
| **Security** | CVE advisories, EPSS, CVSS v2/v3/v4, known exploits | Watches, policies, violations | Vulnerability summary (deprecated) |
| **Packages** | Public metadata (description, homepage, OpenSSF) | Components identified during scanning | Packages/versions stored in Artifactory |
| **Access** | GraphQL only | REST + CLI (`jf api /xray/...`) | GraphQL only |
| **Use case** | Research, compliance reporting, package evaluation | Runtime enforcement, CI/CD gating | Inventory, location queries |
