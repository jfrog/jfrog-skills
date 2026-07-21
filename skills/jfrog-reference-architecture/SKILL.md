---
name: jfrog-reference-architecture
description: >-
  Guides JFrog Platform topology, sizing (RPM, t-shirt templates), deployment,
  multi-site use cases, SaaS vs self-managed, HA, air-gapped, and disaster
  recovery using the official Reference Architecture site as the sole source of
  facts. Use this skill when the user asks how to size Artifactory or Xray,
  which deployment pattern to choose, single vs multi site, active-active,
  active-passive, CI/CD separation, Helm/Kubernetes install planning, or
  reference architecture (live WebFetch from jfrog.com/reference-architecture).
  Do NOT use for artifact search or download, repository or permission admin,
  CVE or vulnerability lookups, live jf CLI operations against their instance,
  or package curation — use the jfrog base skill or
  jfrog-package-safety-and-download instead.
compatibility: >-
  Requires outbound HTTPS (WebFetch or equivalent). Request full_network when
  the runtime blocks fetches. No jf CLI or configured JFrog instance required
  for planning-only questions.
metadata:
  role: workflow
---

# JFrog Reference Architecture

Planning skill for topology, sizing, and deployment. Answers must come from
**live fetches** of the [JFrog Platform Reference Architecture](https://jfrog.com/reference-architecture/) — not from training data or duplicated tables in this repo.

## Prerequisites

- Read `../jfrog/SKILL.md` for JFrog Platform concepts, product vocabulary, and routing to other workflows.
- **No `jf` CLI required** for planning-only questions (no live instance needed).

## Source of truth

| Allowed in this skill | Not allowed |
|-----------------------|-------------|
| Fetch procedures, workflows, output templates | Sizing RPM tables, use-case narratives, deployment checklists copied from the site |
| Helm chart **preference** (jfrog-platform on Kubernetes) | Hardcoded slug lists or criteria |

**Every factual claim** (numbers, template names, limitations, infrastructure guidance) must come from a **`WebFetch` in the current session**. If fetch fails, retry or ask the user to open the URL — do not guess from memory.

**Citations:** Use the `URL:` line from the relevant section in the fetched content (public HTML URL). You may note content was read from `llms-full.txt`.

For fetch URLs, size thresholds, and the fallback ladder, see [references/doc-access.md](references/doc-access.md).

## Gotchas

| Symptom | Mitigation |
|---------|------------|
| Sizing numbers or use-case names not on the official site | `WebFetch` ref-arch first; cite `URL:` from the fetch — not training data |
| `small` template recommended for production | Re-read production warnings in the fetched Artifactory/Xray sizing sections |
| SaaS section missing or 404 | SaaS paths use prefix **`jfrog-saas`**, not `saas` |
| HA storage guidance wrong | Per ref arch: **`cluster-file-system`** or object storage — not `file-system` for HA |
| `WebFetch` blocked, truncated, or over size limits | Request `full_network`; downgrade per [references/doc-access.md](references/doc-access.md) |

## Session bootstrap

Before answering a reference-architecture question:

1. **`WebFetch`** `https://jfrog.com/reference-architecture/llms-full.txt` (primary).
2. Keep the response in context for follow-ups in the same thread.
3. Note approximate response size. If over **1 MB**, or truncated, follow the downgrade path in `references/doc-access.md` (sitemap + targeted `index.md`).
4. Re-bootstrap when uncertain after long unrelated conversation.

Request **`full_network`** (or the runtime equivalent) when `WebFetch` is blocked.

### Parsing llms-full.txt

Sections are separated by `---` and typically include:

- `# <Title>`
- `URL: https://jfrog.com/reference-architecture/...`
- Optional `> <summary>`
- Body text (may be condensed vs the HTML page)

Use only text from the fetch. For recommendations, cite the section’s `URL:` line.

## Intent routing

| User intent | Where to look in llms-full | Fallback |
|-------------|---------------------------|----------|
| Sizing | `# Sizing`, `# AWS Sizing`, Azure, GCP sections | `.../self-managed/deployment/sizing/index.md` |
| Topology / use case | Matching title + `URL:` for SaaS (`jfrog-saas`) or self-managed | That path’s `index.md` |
| List use cases | All `URL:` lines containing `/use-cases/` | `sitemap.xml` |
| Deployment / install | Deployment and considerations sections | `.../deployment/index.md` |
| Disaster recovery | DR playbook / tiers sections | Matching `index.md` |

SaaS paths use prefix **`jfrog-saas`**, not `saas`.

## Workflow: Sizing

1. Bootstrap `llms-full.txt` (unless downgraded to single-page fetch).
2. Find the **Sizing** section. Build follow-up questions from **Artifactory Sizing Templates Criteria** in the fetch (peak **Requests Per Minute** and **Concurrent Connections** per template).
3. Use **`AskQuestion`** when available; otherwise numbered options using labels from the fetched table only.
4. If the user mentions Xray or production, use **Xray Sizing Templates Criteria** and production warnings from the same fetch (e.g. small is not for production).
5. If the user names a cloud, use **AWS Sizing** / **Azure** / **GCP** sections from the fetch.
6. Recommend a template (`small` through `2xlarge`) and cite the sizing page `URL:` from the dump.
7. **Helm:** Recommend the [jfrog-platform](https://github.com/jfrog/charts/tree/master/stable/jfrog-platform) chart with `-f sizing/platform-<template>.yaml`. `WebFetch` the chart README if the user wants exact install commands.

### Sizing output template

```markdown
## Recommended sizing

- **Template**: <from fetched table>
- **Artifactory**: <RPM and concurrent connections from fetched table>
- **Xray** (if applicable): <from fetched Xray table>
- **Source**: <URL: line from Sizing section>
- **Helm**: `helm upgrade --install` with `-f sizing/platform-<template>.yaml` on chart `jfrog/jfrog-platform`
- **Caveats**: <Notes / additional factors from fetched Sizing section>
```

## Workflow: Topology and use cases

1. Bootstrap `llms-full.txt`.
2. Ask **1–2 follow-ups per turn** until hosting model and site count are clear:
   - SaaS vs self-managed (if unsure, fetch home/overview from dump and mention SaaS value proposition from site text).
   - Single site vs multi site.
   - For multi-site: DR/failover, geo performance, CI/CD separation, edges, hybrid variants, IoT, subsidiaries/vendors, air-gapped (self-managed only), archiving.
3. **List documented use cases:** Filter all `URL:` lines containing `/use-cases/` from the dump; group under **JFrog SaaS** vs **Self-managed**. Fallback: `sitemap.xml` if the user wants sitemap-complete listing.
4. **Recommend a use case:** Match the user’s answers to sections in the dump; cite each `URL:`. If the dump is insufficient for one page, `WebFetch` `https://jfrog.com/reference-architecture/<path>/index.md` for that `URL:` path.
5. **No exact match:** Suggest combining documented patterns (e.g. active-passive for DR + main-site-with-edges); fetch each component section before describing how they combine. Remind that the ref arch is a starting point for emerging cases.

## Workflow: Deployment

1. Bootstrap `llms-full.txt`.
2. Use deployment, considerations, HA, database, storage, and cloud sections from the fetch.
3. **Default policy (not a substitute for ref-arch facts):** Deploy on **Kubernetes** with the **jfrog-platform** Helm chart even when the user only wants Artifactory — enable Artifactory, disable other products in values. Do not steer to legacy standalone Artifactory charts unless the user explicitly requires non-Kubernetes deployment.
4. Production reminders from fetched content where applicable: external managed PostgreSQL (not bundled chart DB for production), object storage / `cluster-file-system` for HA, Enterprise license for `replicaCount > 1`.
5. `WebFetch` the [chart README](https://github.com/jfrog/charts/tree/master/stable/jfrog-platform) when the user needs install snippets, OpenShift (`openshift-values.yaml` last), or RabbitMQ quorum files.

### Deployment output template

```markdown
## Deployment recommendation

- **Runtime**: Kubernetes + jfrog-platform Helm chart
- **Reference**: <URL: from deployment-related sections>
- **Key considerations**: <bullets from fetched considerations sections>
- **Helm** (if requested): <commands from chart README fetch>
```

## When to read reference files

- **Fetch ladder, Markdown URL rule, size governance:** [references/doc-access.md](references/doc-access.md)

## Examples

**Sizing:** User asks what sizing to set for Artifactory → bootstrap llms-full → ask peak RPM using fetched table options → recommend template and Helm sizing file.

**List use cases:** User asks for all documented use cases → bootstrap llms-full → list grouped by SaaS vs self-managed from `URL:` lines in dump.

**Topology:** User needs DR across two regions → clarify SaaS vs self-managed → recommend active-passive (or related) section from dump with `URL:` citations.

**Deploy:** User wants Artifactory on EKS → deployment + AWS sizing sections from dump → jfrog-platform chart with external DB and sizing values file.
