# Reference Architecture — documentation access

How to fetch official content. **Do not copy page bodies into this repo.**

## Primary bootstrap

| Resource | URL | When |
|----------|-----|------|
| **Full dump** | https://jfrog.com/reference-architecture/llms-full.txt | Start of every reference-architecture session |

Parse sections by `---`, `# <Title>`, and `URL: https://jfrog.com/reference-architecture/...`.

## Fallback ladder

Use only when `llms-full.txt` fails, is truncated, is over size limits, or lacks a needed section:

1. https://jfrog.com/reference-architecture/llms.txt — orientation; documents the `index.md` URL pattern
2. https://jfrog.com/reference-architecture/`<path>`/index.md — targeted page Markdown
3. https://jfrog.com/reference-architecture/sitemap.xml — exhaustive URL list; verify paths
4. HTML URL (same path without `index.md`) — if `index.md` fails

### Markdown URL rule (from llms.txt)

Append `index.md` to the section path:

- HTML: `https://jfrog.com/reference-architecture/self-managed/deployment/sizing/`
- Markdown: `https://jfrog.com/reference-architecture/self-managed/deployment/sizing/index.md`

Base: `https://jfrog.com/reference-architecture/`

SaaS sections use prefix **`jfrog-saas`**, not `saas`.

## Size governance

| Fetched size | Guidance |
|--------------|----------|
| &lt; 300 KB (current llms-full ~120 KB) | Keep llms-full as primary; one bootstrap per ref-arch thread |
| 300 KB – ~1 MB | OK for ref-arch-focused turns; avoid re-fetching full dump if already in context |
| ~1 – 2 MB | Prefer sitemap + targeted `index.md` for most questions; llms-full only for broad survey |
| &gt; 2 MB or truncation | Do not mandatory-bootstrap llms-full; use fallback ladder only |

**Downgrade early when:**

- `WebFetch` truncates or warns on size
- Ref-arch is a side question in a context-heavy session → fetch one `index.md` for the topic
- Question is narrowly scoped (e.g. RPM only) → optional single `.../sizing/index.md` instead of full dump

If over 1 MB on bootstrap, tell the user targeted fetches were used and why.

## Citations

- User-facing link: the `URL:` line from the section (HTML).
- Optional note: content from `llms-full.txt` in this session.

## Outside ref-arch (Helm install details)

- Chart: https://github.com/jfrog/charts/tree/master/stable/jfrog-platform
- `WebFetch` chart README when the user needs install commands, HA filestore settings, or OpenShift values.
