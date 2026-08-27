#!/usr/bin/env python3
"""Helpers for the Sync Plugins workflow (.github/workflows/sync-plugins.yml).

Usage:
  python3 .github/scripts/jfrog-sync-plugins.py matrix
  python3 .github/scripts/jfrog-sync-plugins.py copy
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

PLUGINS_FILE: Path = Path(".github/plugins.json")
SOURCE: str = "skills"                # directory under jfrog-skills we vendor into each plugin
UPSTREAM_DIR: Path = Path("upstream")  # sibling checkout of jfrog-skills@version (set by the workflow)
PLUGIN_DIR: Path = Path("plugin")      # sibling checkout of the target plugin repo (set by the workflow)
USAGE: str = "usage: jfrog-sync-plugins.py matrix|copy"

# Historical skill directory names → current names. Applied to plugin docs
# (README.md, VENDOR.md, POWER.md, docs/, steering/, dest-prefix README)
# after skills/ is copied so a rename in jfrog-skills does not leave plugin
# copy pointing at deleted directories. Only applied when the new dir exists
# in the copied skills tree. When you rename a skill directory, add the
# old → new pair here before the next release.
SKILL_DIR_ALIASES: dict[str, str] = {
    "jfrog-package-safety-and-download": "jfrog-package-curation",
    "jfrog-ai-catalog-skills": "jfrog-ai-catalog",
}

# Feature-table labels that tracked the old directory names.
SKILL_DISPLAY_ALIASES: dict[str, str] = {
    "Package safety & download": "Package curation",
}

DOC_FILENAMES: frozenset[str] = frozenset({"README.md", "VENDOR.md", "POWER.md"})
SKILLS_BLOB_RE: re.Pattern[str] = re.compile(
    r"(https://github\.com/jfrog/jfrog-skills/blob/)v\d+\.\d+\.\d+"
)
SKILLS_CODELOAD_RE: re.Pattern[str] = re.compile(
    r"(https://codeload\.github\.com/jfrog/jfrog-skills/(?:tar\.gz|zip)/)v\d+\.\d+\.\d+"
)
PINNED_AT_RE: re.Pattern[str] = re.compile(r"(pinned at `)v\d+\.\d+\.\d+(`)")


def fail(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)
    sys.exit(1)


def create_matrix() -> None:
    """Emit a GitHub Actions matrix from .github/plugins.json.

    Optional env:
      PLUGIN  Plugin name to include, or "all" (default). Unknown names fail.

    Writes `matrix=<compact-json>` to $GITHUB_OUTPUT and prints it to stdout.

    Example input (.github/plugins.json):
        { "plugins": [{ "name": "claude-plugin", "dest_prefix": "" }] }

    Example output (appended to $GITHUB_OUTPUT):
        matrix={"include":[{"name":"claude-plugin","dest_prefix":""}]}
    """
    data: dict = json.loads(PLUGINS_FILE.read_text())
    plugins: list[dict] = data["plugins"]
    plugin_filter: str = (os.environ.get("PLUGIN") or "all").strip()
    if plugin_filter and plugin_filter != "all":
        known = [p["name"] for p in plugins]
        plugins = [p for p in plugins if p["name"] == plugin_filter]
        if not plugins:
            fail(f"unknown plugin {plugin_filter!r}; known: {', '.join(known)}")

    matrix: dict = {"include": plugins}

    output_file: str | None = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a", encoding="utf-8") as f:
            f.write(f"matrix={json.dumps(matrix, separators=(',', ':'))}\n")

    print(json.dumps(matrix, indent=2))


def load_json_list(env_name: str) -> list[dict]:
    """Parse a JSON array from an env var; treat missing/empty/null as []."""
    raw: str = os.environ.get(env_name, "[]") or "[]"
    if raw.strip() in ("", "null"):
        return []
    data = json.loads(raw)
    return data if isinstance(data, list) else []


def resolve_json_parent(data: dict, dotted_path: str) -> tuple[dict | list, str | int]:
    """Walk a dotted JSON path; return (parent, leaf_key) for the final field.

    Numeric path segments are treated as list indices, e.g.
    "plugins.0.version" -> (plugins[0], "version").
    """
    keys: list = [int(p) if p.isdigit() else p for p in dotted_path.split(".")]
    parent: dict | list = data
    for key in keys[:-1]:
        parent = parent[key]
    return parent, keys[-1]


def copy_skills_folder() -> None:
    """Copy skills/ into the plugin at DEST_PREFIX, rewrite plugin docs for
    renamed skill directories, then update pins and bump each configured
    version file in lock-step — but only bump versions if the copy, pin
    update, or doc rewrite actually produced changes.

    Required env:
      DEST_PREFIX    Prefix inside the plugin, may be empty.
                     e.g. "plugins/jfrog" -> skills/ lands at plugins/jfrog/skills/.

    Optional env:
      VERSION        Tag being synced (e.g. "v0.22.0"). Required when PIN_UPDATES
                     is non-empty; written into each pin field as-is. Also used
                     to retarget jfrog-skills version links in plugin docs.
      VERSION_BUMPS  JSON array of {file, path} entries.
                     Each entry points to a JSON file inside the plugin and a
                     dotted path to the semver field to patch-bump.
      PIN_UPDATES    JSON array of {file, path} entries.
                     Each entry points to a vendor-pin JSON file (e.g.
                     sync-skills-vendor.json) whose field is set to VERSION.
                     Needed for plugins whose CI re-vendors from the pin.
    """
    dest_prefix: str = os.environ.get("DEST_PREFIX", "").strip("/")
    bumps: list[dict] = load_json_list("VERSION_BUMPS")
    pins: list[dict] = load_json_list("PIN_UPDATES")
    version: str = os.environ.get("VERSION", "").strip()

    src: Path = UPSTREAM_DIR / SOURCE
    if not src.exists():
        fail(f"upstream missing {SOURCE}/ at {src}")

    dest: Path = PLUGIN_DIR / dest_prefix / SOURCE if dest_prefix else PLUGIN_DIR / SOURCE
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dest)
    print(f"Copied {src} -> {dest.relative_to(PLUGIN_DIR)}")

    if pins:
        if not version:
            fail("VERSION is required when PIN_UPDATES is set")
        for pin in pins:
            set_json_value(PLUGIN_DIR / pin["file"], pin["path"], version)

    rewrite_plugin_skill_docs(PLUGIN_DIR, dest_prefix, version)

    if not bumps:
        return
    if not has_changes(PLUGIN_DIR):
        print("No skill changes detected — skipping version bumps.")
        return
    for bump in bumps:
        bump_patch_version(PLUGIN_DIR / bump["file"], bump["path"])


def skills_dest(plugin_dir: Path, dest_prefix: str) -> Path:
    return plugin_dir / dest_prefix / SOURCE if dest_prefix else plugin_dir / SOURCE


def current_skill_dirs(plugin_dir: Path, dest_prefix: str) -> set[str]:
    root = skills_dest(plugin_dir, dest_prefix)
    if not root.is_dir():
        return set()
    return {path.name for path in root.iterdir() if path.is_dir()}


def iter_plugin_doc_paths(plugin_dir: Path, dest_prefix: str) -> list[Path]:
    """Markdown the sync is allowed to rewrite. Never walks skills/."""
    paths: list[Path] = []
    seen: set[Path] = set()

    def add(path: Path) -> None:
        resolved = path.resolve()
        if resolved in seen or not path.is_file():
            return
        seen.add(resolved)
        paths.append(path)

    for name in DOC_FILENAMES:
        add(plugin_dir / name)
    docs_dir = plugin_dir / "docs"
    if docs_dir.is_dir():
        for path in sorted(docs_dir.glob("*.md")):
            add(path)
    steering_dir = plugin_dir / "steering"
    if steering_dir.is_dir():
        for path in sorted(steering_dir.glob("*.md")):
            add(path)
    if dest_prefix:
        add(plugin_dir / dest_prefix / "README.md")
        add(plugin_dir / dest_prefix / "VENDOR.md")
    plugins_root = plugin_dir / "plugins"
    if plugins_root.is_dir():
        for path in sorted(plugins_root.glob("*/README.md")):
            add(path)
    return paths


def skill_dir_replacements(present: set[str]) -> list[tuple[str, str]]:
    replacements: list[tuple[str, str]] = []
    for old, new in SKILL_DIR_ALIASES.items():
        if new not in present:
            continue
        replacements.append((old, new))
    replacements.sort(key=lambda pair: len(pair[0]), reverse=True)
    if "jfrog-package-curation" in present:
        for old, new in SKILL_DISPLAY_ALIASES.items():
            replacements.append((old, new))
    return replacements


def rewrite_text(text: str, replacements: list[tuple[str, str]], version: str) -> str:
    for old, new in replacements:
        text = text.replace(old, new)
    if version:
        text = SKILLS_BLOB_RE.sub(rf"\g<1>{version}", text)
        text = SKILLS_CODELOAD_RE.sub(rf"\g<1>{version}", text)
        text = PINNED_AT_RE.sub(rf"\g<1>{version}\g<2>", text)
    return text


def rewrite_plugin_skill_docs(plugin_dir: Path, dest_prefix: str, version: str) -> int:
    """Rewrite plugin docs so skill names and pin links match the copied tree.

    Returns the number of files changed.
    """
    present = current_skill_dirs(plugin_dir, dest_prefix)
    replacements = skill_dir_replacements(present)
    if not replacements and not version:
        return 0

    changed = 0
    for path in iter_plugin_doc_paths(plugin_dir, dest_prefix):
        original = path.read_text(encoding="utf-8")
        updated = rewrite_text(original, replacements, version)
        if updated == original:
            continue
        path.write_text(updated, encoding="utf-8")
        changed += 1
        print(f"Rewrote skill names in {path.relative_to(plugin_dir)}")
    return changed


def has_changes(repo_dir: Path) -> bool:
    """Return True if `git status --porcelain` reports any working-tree changes."""
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo_dir,
        capture_output=True,
        text=True,
        check=True,
    )
    return bool(result.stdout.strip())


def set_json_value(file_path: Path, dotted_path: str, value: str) -> None:
    data: dict = json.loads(file_path.read_text())
    parent, leaf_key = resolve_json_parent(data, dotted_path)
    previous = parent[leaf_key]
    parent[leaf_key] = value
    file_path.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Set {file_path.relative_to(PLUGIN_DIR)} {dotted_path}: {previous} -> {value}")


def bump_patch_version(file_path: Path, dotted_path: str) -> None:
    # Patch-only: the sync-plugins PR commit/title must lead with [patch] so each
    # plugin's release workflow ships a release on merge.
    data: dict = json.loads(file_path.read_text())
    parent, leaf_key = resolve_json_parent(data, dotted_path)

    current: str = parent[leaf_key]
    major, minor, patch = current.split(".")
    new_version: str = f"{major}.{minor}.{int(patch) + 1}"
    parent[leaf_key] = new_version

    file_path.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Bumped {file_path.relative_to(PLUGIN_DIR)} {dotted_path}: {current} -> {new_version}")


def main() -> None:
    # sys.argv[0] is the script path; sys.argv[1] is the first real argument.
    # We expect exactly one argument: either "matrix" or "copy".
    command: str = sys.argv[1] if len(sys.argv) == 2 else ""

    if command == "matrix":
        create_matrix()
    elif command == "copy":
        copy_skills_folder()
    else:
        fail(USAGE)


if __name__ == "__main__":
    main()
