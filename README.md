# JFrog Skills

> **Beta Notice:** This software is in beta and licensed under the [Apache License 2.0](LICENSE). For clarity: This software is provided "as-is" without warranty of any kind. Behavior, APIs, conventions, and structure may change without notice between releases. JFrog makes no guarantees of backward compatibility during the 0.x release cycle. Use in production environments is at your own risk.

This repository ships AI agent skills for the JFrog Platform: 

    - `jfrog`: The base skill covering CLI setup, artifact operations, security queries, AQL, and GraphQL
    - `jfrog-package-safety-and-download`: A workflow skill for package safety checks and curation-aware downloads 
    
Install them in your AI coding agent and interact with JFrog through natural language.

## Requirements

- [`jf` CLI](https://jfrog.com/getcli/), `curl`, and `jq` on PATH
- A configured JFrog instance (`jf config add`)

## Installation

From remote repository:

```bash
npx skills add git@github.com:jfrog/jfrog-skills.git --skill jfrog --skill jfrog-package-safety-and-download
```

From a local clone:

```bash
npx skills add . --skill jfrog --skill jfrog-package-safety-and-download
```

Run `npx skills --help` for more usage information.

## Feedback

This project is in beta and your feedback directly shapes what comes next. If something doesn't work as expected, a prompt produces surprising results, or you have ideas for new capabilities, we want to hear about it.

- **Open an issue** on this repository for bug reports, feature requests, or general feedback.
- **Email us** at `skills.feedback@jfrog.com`.

## What Can You Do With This?

<!-- markdownlint-disable MD028 -->

### Search and Download Artifacts

Download, search, version queries, metadata, evidence.

Try asking:

> What's the latest version of *package-name*?

> Download *package-name* version *X.Y.Z* from *repo-name*

> What versions of *package-name* are available between *X* and *Y*?

> Find all artifacts matching *pattern* in *repo-name*

> Show me metadata for *artifact-name* in *repo-name*

> List all artifacts under groupId *group-id* in *repo-name*

> I have a file with SHA256 `abc123...`. Find it in Artifactory

> Find recently modified items under path *repo-name*/*path*

> Download the JAR, sources, and javadoc for guava 33.2.1-jre from libs-release-local

> List all tags for Docker image `myapp` in docker-local

### Manage Security and Vulnerabilities

CVE lookups, upgrade safety checks, security profiles, exposures (secrets, IaC, application security).

Try asking:

> Does *package-name* version *X.Y.Z* have any known vulnerabilities?

> Is it safe to upgrade to *package-name* version *X.Y.Z*?

> Which of my artifacts are affected by *CVE-ID*?

> Give me a full security profile for *package-name* version *X.Y.Z*

> Show me exposure findings for *repo-name*. Any leaked secrets or IaC issues?

> What application security risks has Xray found in *build-name*?

### Work with Compliance and Curation

Curation status, license risks, audit events, violation tracking.

Try asking:

> Is *package-name* version *X.Y.Z* approved?

> Any license risks for *package-name* version *X.Y.Z*?

> Show me curation audit events from the last 7 days

> Summarize curation activity this month: how many packages were blocked and why?

### Examine Builds and Provenance

Build info, artifact-to-build tracing, checksum verification.

Try asking:

> Show me the artifacts, dependencies, and VCS info for *build-name* build *N*

> Which build produced *artifact-name* in *repo-name*?

> Show me the last 5 builds of *build-name*

> What artifacts were produced by the last build of *build-name*?

> What changed between build *N* and build *M* of *build-name*?

### Manage Storage and Cleanup

Stale artifacts, large files, download activity, property queries.

Try asking:

> Find artifacts in *repo-name* not downloaded in the last 3 months, larger than 1MB

> What are the largest files in *repo-name*?

> Show me the top 20 most downloaded artifacts in *repo-name*

> Show me artifacts in *repo-name* that have never been downloaded

> Find all SNAPSHOT JARs in *repo-name* created more than 90 days ago

> Find all files in *repo-name* modified in the last 7 days

> Show me artifacts uploaded by *username* in the last 60 days

> Find all artifacts in *repo-name* with property *key*=*value*

> Find all JARs in *repo-name* larger than 50MB or created in the last 3 days

> Find all files in *repo-name* but exclude anything under *path*

> Show me everything Artifactory knows about *artifact-name* in *repo-name*

> I have SHA-256 `d919d904...`. Which repos and paths contain this artifact?

### Administer your JFrog Platform

CLI setup, multi-instance management, access tokens.

### Execute Multi-Step Workflows

The skill also handles real-world scenarios that span multiple capabilities:

> I want to upgrade *package-name* to the latest safe version. Show me available versions, check for vulnerabilities and curation status, and download the best candidate.

> Which build produced *artifact-name* in *repo-name*? Show me build info, VCS commit, and verify the checksum.

> Which packages in *repo-name* have critical CVEs? Check curation status for the top 3 and whether they've been downloaded despite the vulnerability.

> Set up the JFrog CLI, show me available repositories, download *package-name* from *repo-name*, and check it for vulnerabilities.

> Analyze Docker image *image:tag* in *repo-name*: layers, size, and security findings

> Verify that `./lib/my-artifact.jar` hasn't been tampered with. Check it against Artifactory and show me its build provenance

> Search for all *package-name* packages across our repos. Show me metadata, curation status, and any CVEs.

<!-- markdownlint-enable MD028 -->

## How It Works

When your agent receives a JFrog-related request, it reads the skill and matches the task to the appropriate reference files. It loads only the context needed for the current operation, typically 1-3 reference files, keeping the agent focused and efficient. All operations execute through the `jf` CLI or REST/GraphQL APIs.

See [ARCHITECTURE.md](ARCHITECTURE.md) for architecture details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions, naming rules, and guidelines.
