# Catalog entities

When to read this file:

- Querying **public package metadata** (descriptions, vulnerabilities, licenses, operational info).
- Working with **Custom Catalog** (org-specific labels, package views, federation).
- Looking up **vulnerability details** beyond Xray (advisories, EPSS, CWE, known exploits).
- Querying **OpenSSF scorecards**, **ML model metadata**, or **MCP service** registries.
- Using OneModel GraphQL with `publicPackages`, `customPackages`,
  `publicSecurityInfo`, `publicLegalInfo`, `publicOperationalInfo`,
  `publicCatalogLabels`, or `publicRemoteServices` query roots.

Catalog entities via **OneModel GraphQL API** (`/onemodel/api/v1/graphql`).

OneModel query workflow (credentials, schema fetch, validation, execution): `references/onemodel-graphql.md`.

## Two catalog layers

| Layer | Scope | Description |
|-------|-------|-------------|
| **Public Catalog** | Global | JFrog global package DB — security, legal, operational metadata across ecosystems |
| **Custom Catalog** | Organization | Org overlay: custom labels, per-org views, federation config |

Custom Catalog overlays Public Catalog — org labels/metadata without changing public data.

## Public Catalog entities

### PublicPackage

Package in JFrog global package database.

| Field | Description |
|-------|-------------|
| `name` | Package name (`lodash`, `spring-boot-starter-web`) |
| `type` | Package type (`npm`, `maven`, `pypi`) |
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

Specific version with security, legal, operational analysis.

| Field | Description |
|-------|-------------|
| `version` | Version string |
| `isLatest` | Whether latest version |
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

Richer vulnerability data than Xray violations — deep-dive analysis + advisory lookups.

| Field | Description |
|-------|-------------|
| `name` | CVE id (`CVE-2021-44228`) |
| `ecosystem` | Affected ecosystem |
| `severity` | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` |
| `description` | Detailed impact description |
| `cvss` | CVSS scores — v2, v3, **and v4** |
| `epss` | EPSS exploit likelihood |
| `knownExploit` | Known exploit info |
| `withdrawn` | CVE retracted |
| `aliases` | Alternative identifiers |
| `references` | Advisory URLs |
| `publishedAt`, `modifiedAt` | Timestamps |

Advisory sources (`advisories` connection):
- **NVD** — NIST vulnerability DB
- **GHSA** — GitHub Security Advisory
- **JFrog Advisory** — JFrog research (impact reasons)
- **Debian Security Tracker**
- **RedHat OVAL**

Additional connections: `cwesConnection` (CWE entries), `cpesConnection`
(CPE entries), `publicPackageInfo` (affected packages + versions).

Query: `publicSecurityInfo.searchVulnerabilities(where: {...})`.

#### Filtering limitations

`searchVulnerabilities` filters by CVE name, ecosystem, severity, CVSS,
EPSS, known exploit status, publication date — but **not** by affected
package name. No `hasPublicPackageInfoWith` or similar filter on
`PublicVulnerabilityWhereInput`. To find vulnerabilities affecting specific
package, use alternatives:

- **Version-level security info** (GraphQL): query
  `publicPackages.getPackage(type, name)` →
  `versionsConnection → securityInfo → vulnerabilitiesConnection` for
  CVEs affecting specific versions.
- **Individual CVE lookup**: `searchVulnerabilities(where: { name: "<CVE>" })`
  → inspect `publicPackageInfo.vulnerablePublicPackagesConnection` on
  `generic` ecosystem entry.

#### Ecosystem multiplicity

Single CVE → multiple `PublicVulnerability` entries (one per ecosystem). `ecosystem` field determines entry:

| Ecosystem | Contains |
|-----------|----------|
| `generic` | Non-OS package-level data (npm, maven, pypi, go, etc.) — includes `publicPackageInfo` with vulnerable + fix versions |
| `debian`, `redhat`, `ubuntu`, etc. | OS-specific advisory data — severity may differ from NVD; `publicPackageInfo` typically empty (OS packages tracked separately) |

CVE lookup by name: `searchVulnerabilities(where: { name: "<CVE>" })`
returns all ecosystem entries. For npm/maven library affected packages + fix versions → filter/focus on `generic` entry. `getVulnerability` requires `name` + `ecosystem` — use `searchVulnerabilities` when ecosystem unknown.

### PublicLicense

License metadata with permission, condition, limitation details.

| Field | Description |
|-------|-------------|
| `name` | License name (`Apache-2.0`, `MIT`) |
| `spdxId` | SPDX identifier |
| `permissions` | What license permits |
| `limitations` | Restrictions imposed |
| `patentConditions` | Patent grant conditions |
| `noticeFiles` | Required notices |

Query: `publicLegalInfo.searchLicenses(where: {...})`.

### PublicPackageOperationalInfo

Operational risk assessment for packages + versions.

| Entity | Key data |
|--------|----------|
| **OpenSSF scorecard** | Overall score + check scores/pass-fail |
| **End-of-life** | Package/version EOL status + justification |
| **Popularity** | JFrog popularity by segment/tier, download counts |

### MCP services and tools

Public Catalog also indexes MCP (Model Context Protocol) services:

| Entity | Description |
|--------|-------------|
| `PublicMcpService` | MCP service: name, description, version |
| `PublicMcpTool` | MCP service tool + arguments |
| `PublicMcpRemote` | Remote MCP server config |

Query: `publicRemoteServices.searchMcpServices(where: {...})`.

## Custom Catalog entities

### CustomPackage

Package in org private catalog view.

| Field | Description |
|-------|-------------|
| `customCatalogId` | Org-scoped identifier |
| `name`, `type`, `ecosystem`, `namespace` | Package identity |
| `isListedPackage` | Whether visible in Catalog UI |
| `customCatalogAddedAt`, `customCatalogModifiedAt` | Org-specific timestamps |

Connections: `versionsConnection`, `legalInfo`,
`customCatalogLabelsConnection`.

### CustomCatalogLabel

Org-defined labels for categorizing packages.

| Field | Description |
|-------|-------------|
| `name` | Label name |
| `description` | What label represents |
| `color` | Display color |
| `labelType` | `MANUAL` or `AUTOMATIC` |
| `assignmentInfo` | How/when label assigned |

Labels assignable to custom packages + public packages/versions within org catalog scope. Custom Catalog mutations: create, update, delete labels.

### CustomCatalogFederation

Config for federating catalog data across JFrog deployments.

## Catalog vs. Xray vs. Stored Packages

Three domains, different views of package + security data:

| Aspect | Catalog | Xray | Stored Packages |
|--------|---------|------|-----------------|
| **Scope** | Global knowledge base + org overlay | Instance-scoped scanning | Instance-scoped storage |
| **Security** | CVE advisories, EPSS, CVSS v2/v3/v4, known exploits | Watches, policies, violations | Vulnerability summary (deprecated) |
| **Packages** | Public metadata (description, homepage, OpenSSF) | Components identified during scanning | Packages/versions stored in Artifactory |
| **Access** | GraphQL only | REST + CLI (`jf api /xray/...`) | GraphQL only |
| **Use case** | Research, compliance reporting, package evaluation | Runtime enforcement, CI/CD gating | Inventory, location queries |
