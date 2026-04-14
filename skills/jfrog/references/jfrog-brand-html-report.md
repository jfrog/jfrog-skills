# JFrog-aligned styling for standalone HTML reports

Use this reference when producing a **pretty, self-contained HTML file** (single file with embedded CSS) that presents data fetched from the JFrog Platform. It complements the operational steps in `SKILL.md`; it does not replace [JFrog Brand Guidelines](https://jfrog.com/brand-guidelines/).

## When this applies

- The user asked for HTML output (not only Markdown).
- The report should feel **professionally aligned** with JFrog’s public brand (terminology, palette, restraint) without impersonating JFrog or implying endorsement.

## Authoritative source

- **Brand guidelines**: [https://jfrog.com/brand-guidelines/](https://jfrog.com/brand-guidelines/) — rules for JFrog Marks, nominative use, naming, and what not to do (e.g. do not copy JFrog’s site “look and feel” wholesale, do not modify official logos, do not use the favicon on your pages).
- **Media Kit**: linked from that page (logos in AI/PNG). Use official assets only if the user needs a logo; scale proportionally and add clarifying context per the guidelines.

## Naming and copy

- Use **JFrog** with a capital **JF** in prose. For the CLI command name, use lowercase **`jfrog`** where that matches actual command-line usage (per JFrog’s own spelling note on the brand page).
- Use **correct product names**: JFrog Artifactory, JFrog Xray, JFrog Platform, etc., when referring to those products.
- Give the report a **distinct title** that describes the content (e.g. “Repository inventory — Acme Corp — 2026-03-24”). Do **not** name the file or the document as if it were an official JFrog publication.
- Add a short **footer or subtitle** when helpful, e.g. that the document was generated from the user’s environment for their analysis, and is **not** sponsored or endorsed by JFrog (nominative use only).

## Visual design (aligned, not a clone)

The brand page asks users not to imitate JFrog’s proprietary layout and marks. For HTML reports:

- Prefer a **clean, neutral layout**: plenty of whitespace, readable line length, clear hierarchy (one `<h1>`, logical `<h2>`/`h3>`).
- Use **one accent color** associated with JFrog’s digital brand (green) for links, key metrics, or section rules — not for large solid backgrounds that mimic marketing hero sections.
- Use **system or widely available fonts** (`system-ui`, sensible fallbacks) unless the user asks for a specific font. Do not claim typography is “the official JFrog font” unless taken from approved assets.
- Avoid decorative elements that could be confused with JFrog logos, patterns, or the jfrog.com chrome.

## Suggested CSS tokens (embedded in `<style>`)

These are **practical defaults** for internal or technical reports. Adjust if the user’s org has its own template; verify accent against current brand materials if the output is customer-facing.

```css
:root {
  /* Accent — common on JFrog digital properties; confirm vs Media Kit / brand updates */
  --jfrog-accent: #40be46;
  --jfrog-accent-hover: #36a63d;
  /* Neutrals */
  --text-primary: #1a1a1a;
  --text-muted: #5c5c5c;
  --border-subtle: #e4e4e4;
  --bg-page: #ffffff;
  --bg-muted: #f7f8f8;
}

body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif;
  color: var(--text-primary);
  background: var(--bg-page);
  line-height: 1.5;
  margin: 0;
  padding: 2rem clamp(1rem, 4vw, 3rem);
  max-width: 56rem;
}

a {
  color: var(--jfrog-accent);
}
a:hover {
  color: var(--jfrog-accent-hover);
}

h1 {
  font-weight: 700;
  font-size: 1.75rem;
  border-bottom: 3px solid var(--jfrog-accent);
  padding-bottom: 0.35rem;
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.95rem;
}
th, td {
  border: 1px solid var(--border-subtle);
  padding: 0.5rem 0.65rem;
  text-align: left;
}
thead {
  background: var(--bg-muted);
}

code, pre {
  font-family: ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace;
  font-size: 0.9em;
}
```

## Optional logo

Only if the user explicitly wants a logo: use files from the **JFrog Media Kit**, do not alter colors or geometry, and include nearby text that this report is **about** their JFrog deployment, not **by** JFrog — consistent with nominative-use expectations on the brand page.

## Markdown alternative

If the user prefers **Markdown** only, follow normal project conventions; apply this file when the deliverable is **standalone HTML** with branding-aligned styling.
