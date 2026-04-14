# OneModel GraphQL query examples

**Important:** These are illustrative query patterns, not guaranteed templates.
The OneModel schema is a federated supergraph that varies per server based on
products, entitlements, and license. **Always fetch the actual schema** from
`GET /onemodel/api/v1/supergraph/schema` and verify that the domains, types,
fields, and arguments used below exist on the specific server before running
any query. Replace placeholder values (in angle brackets) with actual values.

**When to read this file:** You are constructing OneModel queries and need
domain-specific shapes. For the full workflow (credentials, schema cache,
execution), read `onemodel-graphql.md`. For pagination and variables, read
`onemodel-common-patterns.md`.

## Applications domain

The `applications` namespace queries applications, versions, and bound package
versions.

### List all applications

```graphql
query {
  applications {
    searchApplications(where: {}, first: 50) {
      totalCount
      edges {
        node {
          key
          displayName
          description
          projectKey
          criticality
          maturityLevel
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```

### Get a single application by key

```graphql
query {
  applications {
    getApplication(key: "<app-key>") {
      key
      displayName
      description
      projectKey
      criticality
      maturityLevel
      owners {
        name
        type
      }
      labels {
        key
        value
      }
    }
  }
}
```

### Search applications with filters

```graphql
query {
  applications {
    searchApplications(
      where: {
        projectKey: "<project-key>"
        criticality: "high"
        maturityLevel: "production"
      }
      first: 25
      orderBy: { field: NAME, direction: ASC }
    ) {
      totalCount
      edges {
        node {
          key
          displayName
          criticality
          maturityLevel
        }
      }
    }
  }
}
```

### Get application versions

```graphql
query {
  applications {
    getApplication(key: "<app-key>") {
      displayName
      versionsConnection(first: 20) {
        totalCount
        edges {
          node {
            version
            status
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
```

### Get application with bound package versions

```graphql
query {
  applications {
    getApplication(key: "<app-key>") {
      displayName
      packageVersionsConnection(first: 25) {
        edges {
          node {
            type
            name
            version
          }
        }
      }
    }
  }
}
```

## Stored packages domain

The `storedPackages` namespace queries packages and versions in Artifactory
repositories.

### Search stored packages

`StoredPackageConnection` exposes `edges` and `pageInfo` only (no `totalCount`). `StoredPackageTag` has a single field `name` (not key/value pairs).

```graphql
query {
  storedPackages {
    searchPackages(
      where: { type: "docker" }
      first: 20
    ) {
      edges {
        node {
          name
          type
          description
          tags {
            name
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```

### Get a stored package by name

`StoredPackageVersionConnection` has no `totalCount`. A version’s repos are modeled as `locationsConnection` on `StoredPackageVersion` (e.g. `repositoryKey`, `leadArtifactPath`), not a `repos` field.

```graphql
query {
  storedPackages {
    getPackage(name: "<package-name>", type: "<PACKAGE_TYPE>") {
      name
      type
      description
      versionsConnection(first: 10) {
        edges {
          node {
            version
            locationsConnection(first: 5) {
              edges {
                node {
                  repositoryKey
                  leadArtifactPath
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
```

### Search stored package versions

`StoredPackageVersionWhereInput` does not take package `type` / `name` at the top level — filter via `hasPackageWith` and `StoredPackageWhereInput`.

```graphql
query {
  storedPackages {
    searchPackageVersions(
      where: {
        hasPackageWith: [{ type: "npm", name: "<package-name>" }]
      }
      first: 20
    ) {
      edges {
        node {
          version
          locationsConnection(first: 5) {
            edges {
              node {
                repositoryKey
                leadArtifactPath
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```

## Public packages domain

The `publicPackages` namespace queries packages from public registries (npm,
Maven Central, PyPI, etc.).

### Search public packages

```graphql
query {
  publicPackages {
    searchPackages(
      where: { type: "npm", nameContains: "<search-term>" }
      first: 20
    ) {
      totalCount
      edges {
        node {
          name
          type
          description
          latestVersion {
            version
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```

### Get a public package

```graphql
query {
  publicPackages {
    getPackage(type: "maven", name: "<package-name>") {
      name
      type
      description
      latestVersion {
        version
      }
      versionsConnection(first: 10) {
        edges {
          node {
            version
          }
        }
      }
    }
  }
}
```

### Get a public package version with security and legal info

Version-level `securityInfo` and `legalInfo` use dedicated types
(`PublicPackageVersionSecurityInfo` and `PublicPackageVersionLegalInfo`) whose
subfields differ from the package-level counterparts. Use the subfield
selections shown here — they are verified against the schema.

```graphql
query {
  publicPackages {
    getPackage(type: "npm", name: "<package-name>") {
      name
      versionsConnection(first: 5) {
        edges {
          node {
            version
            securityInfo {
              vulnerabilities: vulnerabilitiesConnection(first: 100) {
                edges {
                  node {
                    name
                    severity
                    cvss {
                      preferredBaseScore
                    }
                    aliases
                    advisories {
                      name
                    }
                    epss {
                      date @dateFormat(format: DD_MMM_YYYY)
                      score
                      percentile
                    }
                  }
                }
              }
              maliciousnessInfo {
                knownToBeMalicious
                disclosedByJFrog
                removedFromIndexAt @dateFormat(format: DD_MMM_YYYY)
              }
            }
            legalInfo {
              licenseInfo {
                expression
                licenses {
                  name
                }
              }
              copyrights(first: 5) {
                edges {
                  node {
                    content
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Public security domain

The `publicSecurityInfo` namespace queries vulnerability advisories from JFrog's
global catalog. A single CVE appears once per ecosystem — use the `name` filter
to find all ecosystem entries for a CVE, or add `ecosystem` to narrow results.

### Search vulnerability by CVE name

`getVulnerability` requires both `name` and `ecosystem`. When the ecosystem is
unknown, use `searchVulnerabilities` with a `name` filter instead — it returns
all ecosystem entries for the CVE.

**Cannot filter by affected package:** `PublicVulnerabilityWhereInput` has no
package-name filter (e.g. no `hasPublicPackageInfoWith`). To find CVEs
affecting a specific package, use `publicPackages.getPackage` → version →
`securityInfo.vulnerabilitiesConnection`, or the Xray REST component summary
API. See `catalog-entities.md` § *Filtering limitations*.

**Ecosystem entries:** A CVE typically appears across multiple ecosystems
(e.g. `generic`, `debian`, `redhat`, `ubuntu`). The `generic` ecosystem
entry contains the actual vulnerable public package list; OS-specific entries
are for OS-level tracking and usually have `totalCount: 0` in
`vulnerablePublicPackagesConnection`.

**Pagination:** Popular CVEs can have hundreds of vulnerable versions (e.g.
lodash CVE-2021-23337 has 395). The example below uses `first: 500` to capture
most CVEs in a single page. If `totalCount` exceeds the page size, paginate
with `after:` and `pageInfo` on `vulnerablePublicPackagesConnection`.

```graphql
query {
  publicSecurityInfo {
    searchVulnerabilities(
      where: { name: "<CVE-ID>" }
      first: 10
    ) {
      totalCount
      edges {
        node {
          name
          ecosystem
          severity
          description
          withdrawn
          publishedAt
          modifiedAt
          cvss {
            preferredBaseScore
            v2 { baseScore accessVector accessComplexity }
            v3 {
              baseScore attackVector attackComplexity
              privilegesRequired userInteraction scope
              confidentialityImpact integrityImpact availabilityImpact
            }
          }
          epss { score percentile date }
          knownExploit { addedAt dueDateAt }
          aliases
          cwesConnection(first: 10) {
            edges {
              node { identifier name }
            }
          }
          advisories {
            name
            url
            ... on PublicVulnerabilityNvdAdvisory {
              severity shortDescription publishedAt
            }
            ... on PublicVulnerabilityGhsaAdvisory {
              severity summary description publishedAt
            }
            ... on PublicVulnerabilityJFrogAdvisory {
              severity shortDescription fullDescription
              impact vulnerabilityType resolution
              impactReasons { name description isPositive }
            }
          }
          publicPackageInfo {
            vulnerablePublicPackagesConnection(first: 500) {
              totalCount
              edges {
                node {
                  publicPackageVersion {
                    version
                    publicPackage { name type }
                  }
                  fixVersionsConnection(first: 5) {
                    edges {
                      node { version }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Release lifecycle domain

The `releaseBundleVersion` namespace queries release bundle versions and
contents.

### Get release bundle version basic info

```graphql
query {
  releaseBundleVersion {
    getVersion(name: "<bundle-name>", version: "<version>") {
      createdBy
      createdAt
    }
  }
}
```

Optional arguments for `getVersion`:

- `repositoryKey` — defaults to `release-bundles-v2`
- `projectKey` — scopes to a specific project

### Get release bundle artifacts

```graphql
query {
  releaseBundleVersion {
    getVersion(name: "<bundle-name>", version: "<version>") {
      artifactsConnection(first: 50) {
        totalCount
        edges {
          node {
            name
            path
            sha256
            packageType
            packageName
            packageVersion
            size
            sourceRepositoryPath
            properties {
              key
              values
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
```

### Get release bundle source builds

```graphql
query {
  releaseBundleVersion {
    getVersion(name: "<bundle-name>", version: "<version>") {
      fromBuilds {
        name
        number
        startedAt
        repositoryKey
      }
    }
  }
}
```

### Get release bundle with artifact evidence

```graphql
query {
  releaseBundleVersion {
    getVersion(name: "<bundle-name>", version: "<version>") {
      artifactsConnection(first: 50, where: { hasEvidence: true }) {
        edges {
          node {
            name
            packageType
            evidenceConnection(first: 5) {
              edges {
                node {
                  predicateType
                  sha256
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### Full traceability — release to build evidence

```graphql
query {
  releaseBundleVersion {
    getVersion(name: "<bundle-name>", version: "<version>") {
      createdBy
      createdAt
      fromBuilds {
        name
        number
        startedAt
        evidenceConnection(first: 10) {
          edges {
            node {
              predicateType
              sha256
              createdBy
              createdAt
            }
          }
        }
      }
    }
  }
}
```

## Evidence domain

The `evidence` namespace searches evidence attached to artifacts in repositories.

### Search evidence in a repository

```graphql
query {
  evidence {
    searchEvidence(
      first: 10
      where: {
        hasSubjectWith: {
          repositoryKey: "<repo-key>"
        }
      }
    ) {
      totalCount
      edges {
        node {
          predicateSlug
          predicateType
          predicate
          verified
          downloadPath
          subject {
            path
            name
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
```

### Search evidence for a specific artifact

```graphql
query {
  evidence {
    searchEvidence(
      where: {
        hasSubjectWith: {
          repositoryKey: "<repo-key>"
          path: "<path/to>"
          name: "<filename>"
        }
      }
    ) {
      edges {
        node {
          predicateSlug
          predicateType
          verified
          downloadPath
        }
      }
    }
  }
}
```

### Get evidence by location

```graphql
query {
  evidence {
    getEvidence(
      repositoryKey: "<repo-key>"
      path: "<path/to>"
      name: "<filename>"
    ) {
      evidenceId
      verified
    }
  }
}
```

### Search evidence with variables

```graphql
query GetEvidence($repoKey: String!, $path: String!, $name: String!) {
  evidence {
    getEvidence(
      repositoryKey: $repoKey
      path: $path
      name: $name
    ) {
      evidenceId
      verified
    }
  }
}
```

Variables:

```json
{
  "repoKey": "example-repo-local",
  "path": "path/to",
  "name": "file.ext"
}
```

## Cross-domain queries

OneModel can combine domains in a single query.

### Release bundle artifacts with evidence

```graphql
query {
  releaseBundleVersion {
    getVersion(name: "<bundle-name>", version: "<version>") {
      createdBy
      createdAt
      artifactsConnection(first: 20) {
        edges {
          node {
            name
            path
            packageType
            evidenceConnection(first: 5) {
              edges {
                node {
                  predicateSlug
                  verified
                }
              }
            }
          }
        }
      }
    }
  }
}
```
