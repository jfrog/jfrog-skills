# Final summary — recap rendering rules

**Give the user a short recap, not the raw checklist.** See
"Customer-facing output" in `SKILL.md` — no step numbers, no raw JSON.
Render a short, emoji-based checklist, not a prose paragraph or a
five-line plain-text list. Three grouped lines cover all five checks:

- **JF CLI & Config** — `jf` installed and connected to a server. Always
  fully resolved here — this checklist only renders once every
  prerequisite up through server connectivity has passed (see "Anything
  else red" below for the alternative).
- **JFrog MCP Plugin** — the MCP plugin check.
- **Project & AI Catalog** — the project-resolution and AI-Catalog-access
  checks, together.

Skip the Node.js setup step — implementation detail, not user-facing.

**Rules for the checklist:**
1. Do **not** use the word "done" anywhere in it.
2. Keep those checks in exactly these three grouped lines — never
   expand back out to five.
3. All three groups fully resolved → use this exact format, verbatim:

   > ✨ **JFrog initialization complete!**
   > ✅ JF CLI & Config
   > ✅ JFrog MCP Plugin
   > ✅ Project & AI Catalog

4. A group with something outstanding gets ⚠️ instead of ✅, plus a
   short fact after an em dash:

   > ✨ **JFrog initialization complete!**
   > ✅ JF CLI & Config
   > ⚠️ JFrog MCP Plugin — not configured
   > ✅ Project & AI Catalog

   For the merged **Project & AI Catalog** line, if only one of the two
   is outstanding name just that one; if both are, separate them with a
   semicolon: `⚠️ Project & AI Catalog — project not set up yet; catalog
   access not entitled`.

5. **Step 8 gets a fourth checklist line, but only when it ran** —
   nothing appears when it was skipped:
   - **Success** — `✅ JFrog Marketplace`, plus this trailing sentence
     after the checklist block, in this exact wording:

     > Added the JFrog marketplace `<marketplace-name>` to Claude Code.
     > Browse available plugins with `/plugins`, or install directly with
     > `claude plugin install <plugin>@<marketplace-name>`

   - **Red** — `⚠️ JFrog Marketplace — not registered`, and no trailing
     sentence.

**If the user asks why** (troubleshooting reference — not part of the render itself):

Never phrase a ⚠️ line as a failure or as something the user needs to
fix before continuing — all of them are non-blocking by design. The
short fact after the em dash is the same underlying cause this skill
has always surfaced, just worded without "pending":

- **Step 5 red/error (MCP plugin not configured):** `not configured`.
  If the user asks why or how to fix it, that's when the specific cause
  from Step 5's `detail` comes in — either run
  `jfrog-reinstall-jfrog-plugin.mjs` (see Step 5) for the per-harness
  reinstall remedy, or point at resolving `jf config`, matching
  whichever cause Step 5 actually reported.
- **Step 5 MCP status** (only when the config check above is green) — the
  **probe** decides, the only signal tied to *this* JPD:
  - exit 4 → ⚠️ `not enabled on this JPD` (+ ask admin, docs from `detail`)
  - exit 1 → ⚠️ `could not confirm it's enabled`
  - exit 0 → MCP is on; check your session for JFrog MCP tools **on this JPD**
    (same base URL, else they don't count): visible → ✅; else ⚠️ `enabled — sign
    in to use it`, and offer sign-in **after the summary, never mid-walk**
- **Step 5b red (OpenCode OAuth incomplete):** `not authenticated`. If
  the user asks, that's when `opencode mcp auth jfrog` comes in.
- **Step 6 hit its retry cap (no project resolved):** `project not set
  up yet`. If the user asks, mention they can pick one whenever they're
  ready. The server/JPD are still recorded to the state file either way
  (see the persistence step at the top of `SKILL.md`'s Final summary
  section); a project picked in an earlier walk, if any, is left as-is
  rather than cleared.
- **Step 7 returned exit 4 (not entitled):** `catalog access not
  entitled`. If the user asks for the fix: ask your JFrog admin for the
  "AI Catalog Read" role to browse or install MCPs from the catalog.
- **Step 7 returned exit 1 (catalog not hosted / unreachable):**
  `catalog not reachable on this JPD`. No fix instruction; there may be
  nothing to fix (this JPD may simply not host the AI Catalog).
- **Something happened this walk** (Node.js/`jf` CLI installed, `jf
  config` connected, a project resolved in Step 6, an MCP placeholder
  substituted in Step 5, etc.): still the same checklist — the action
  itself isn't called out per-line, ✅ is ✅ regardless of whether it
  needed fixing this walk.
- **Anything else red** (Steps 1-4 not all green): one or two sentences
  naming what's blocking and what to do next, no checklist — there's
  nothing to check off yet. Include the raw detector error line if it
  helps debug, without the JSON wrapper.
