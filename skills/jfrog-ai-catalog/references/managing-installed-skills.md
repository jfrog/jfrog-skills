# Managing installed skills

## List currently installed skills

A skill can be installed in two separate places: the **project/harness** location
and the **global** location. For a full inventory, always run **both** lists and
present the union, not just the first:

```bash
# Project/harness install (the default target)
jf skills list --server-id "<SID>" --harness "<harness>" --format json
# Global install (a separate location, always check it too)
jf skills list --server-id "<SID>" --harness "<harness>" --global --format json
# Add --check-updates to compare installed versions against the registry
jf skills list --server-id "<SID>" --harness "<harness>" --check-updates
```

Resolve `<harness>` to the current agent (see `installing-skills.md`).
For Copilot, add `--global` to `--check-updates` too.
**Exception — Kiro and Junie:** neither `--harness kiro` nor `--harness junie`
works, and `list` has no `--path` flag, so list directly from the filesystem:
skill directory names under `.kiro/skills` / `~/.kiro/skills` (or
`$KIRO_HOME/skills`) for Kiro, `.junie/skills` / `~/.junie/skills` for Junie,
each containing a `SKILL.md`. Version/description aren't available this way —
omit those columns. This is a filesystem inventory only: a directory with a
`SKILL.md` cannot confirm the skill was installed via `jf skills install` — a
manually added skill looks identical. Present it as such rather than implying
AI Catalog provenance.
**Never run a bare `jf skills list`** because it errors. Always pass
`--harness <h>` (installed skills) or `--repo <key>` (registry contents).
`--check-updates` is only supported with `--harness` (not with `--repo`). Merge
the project and global results and drop duplicates before presenting. This lists
only skills installed from the AI Catalog with `jf skills install`, not
plugin-bundled or built-in agent skills.

**Presenting installed skills (use this exact format):**

Installed skills (`<harness>`):

| Skill | Version | Description |
|-------|---------|-------------|
| `<name>` | `<version>` | `<description>` |

Include the **Description** column only when the listing provides one (drop it if
every skill's description is empty). With `--check-updates`, add an **Update to**
column (`<latest>`, or `-` when the skill is already current). To upgrade a
skill, see *Update an installed skill* in `installing-skills.md`.

## Remove a skill

"Remove" defaults to removing the **locally installed** skill. There is no
`jf skills uninstall`.

**Confirm before deleting.** Show exactly what will be removed using **this exact
template** and wait for an explicit "yes":

> Removing skill `<slug>` deletes its local install from `<harness>`. Do you want to remove it?

Only after the "yes", delete the installed skill directory with the script (it
rejects a slug that isn't a plain name):

```bash
node "<skill_path>/scripts/jfrog-remove-skill.mjs" --slug '<slug>' --install-dir "<install-dir>"
```

Keep the slug in single quotes (double quotes don't stop `$(...)`). If it has
anything but letters, digits, `.`, `_` or `-`, don't run the command: tell the
user the skill name isn't valid.

On exit `1` or `3`, show its stderr line verbatim and stop. On `2`, fix the call.

On success, reply using **this exact template**:

> Removed `<slug>` from `<harness>`.
> Restart your agent session for the removal to take effect.
