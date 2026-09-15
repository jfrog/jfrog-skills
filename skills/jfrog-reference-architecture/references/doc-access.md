# Reference Architecture — documentation access

Fetch official content in-session. **Do not copy page bodies into this repo.**

## Bootstrap and fallback

| Step | URL | When |
|------|-----|------|
| Primary | https://jfrog.com/reference-architecture/llms-full.txt | Start of every ref-arch session |
| 1 | https://jfrog.com/reference-architecture/llms.txt | llms-full fails or for `index.md` URL pattern |
| 2 | `https://jfrog.com/reference-architecture/<path>/index.md` | One section; append `index.md` to HTML path |
| 3 | https://jfrog.com/reference-architecture/sitemap.xml | Exhaustive URL list |
| 4 | HTML URL (no `index.md`) | If `index.md` fails |

Parse llms-full by `---`, `# <Title>`, and `URL: https://jfrog.com/reference-architecture/...`.
Base path: `https://jfrog.com/reference-architecture/`. SaaS prefix: **`jfrog-saas`**, not `saas`.

## Size governance

| Fetched size | Action |
|--------------|--------|
| Under ~1 MB, not truncated | One llms-full bootstrap per ref-arch thread |
| ~1–2 MB or ref-arch is side context | Prefer sitemap + targeted `index.md` |
| Truncated or over ~2 MB | Skip mandatory llms-full; use fallback ladder only |

Downgrade early for narrow questions (e.g. sizing only → `.../deployment/sizing/index.md`).
Tell the user when targeted fetches replace a full bootstrap.

## Citations and Helm

- User-facing link: the section `URL:` line (HTML).
- Chart details: https://github.com/jfrog/charts/tree/master/stable/jfrog-platform — `WebFetch` README when install commands are needed.
