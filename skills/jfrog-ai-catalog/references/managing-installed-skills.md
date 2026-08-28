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
**Exception — Kiro:** `--harness kiro` errors `unknown agent`, and `list` has
no `--path` flag. List directly from the filesystem instead: skill directory
names under `.kiro/skills` (project) / `~/.kiro/skills` (global, or
`$KIRO_HOME/skills`), each containing a `SKILL.md`. Version/description
aren't available this way — omit those columns. This is a filesystem
inventory only: a directory with a `SKILL.md` cannot confirm the skill was
installed via `jf skills install` — a manually added skill looks identical.
Present it as such rather than implying AI Catalog provenance.
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
`jf skills uninstall`. Delete the installed skill directory after confirming it
exists:

```bash
if [ -d "<install-dir>/<slug>" ]; then
  rm -rf "<install-dir>/<slug>"
else
  echo "Not installed, nothing to remove"
fi
```

**Confirm before deleting.** Show exactly what will be removed using **this exact
template** and wait for an explicit "yes":

> Removing skill `<slug>` deletes its local install from `<harness>`. Do you want to remove it?

On success, reply using **this exact template**:

> Removed `<slug>` from `<harness>`.
> Restart your agent session for the removal to take effect.
