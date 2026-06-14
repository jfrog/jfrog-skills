#!/usr/bin/env python3
"""Helpers for the Sync Plugins workflow (.github/workflows/sync-plugins.yml).

Usage:
  python3 .github/scripts/jfrog-sync-plugins.py matrix
  python3 .github/scripts/jfrog-sync-plugins.py copy
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PLUGINS_FILE: Path = Path(".github/plugins.json")
SOURCE: str = "skills"                # directory under jfrog-skills we vendor into each plugin
UPSTREAM_DIR: Path = Path("upstream")  # sibling checkout of jfrog-skills@version (set by the workflow)
PLUGIN_DIR: Path = Path("plugin")      # sibling checkout of the target plugin repo (set by the workflow)
USAGE: str = "usage: jfrog-sync-plugins.py matrix|copy"


def fail(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)
    sys.exit(1)


def create_matrix() -> None:
    """Emit a GitHub Actions matrix from .github/plugins.json.

    Writes `matrix=<compact-json>` to $GITHUB_OUTPUT and prints it to stdout.

    Example input (.github/plugins.json):
        { "plugins": [{ "name": "claude-plugin", "dest_prefix": "" }] }

    Example output (appended to $GITHUB_OUTPUT):
        matrix={"include":[{"name":"claude-plugin","dest_prefix":""}]}
    """
    data: dict = json.loads(PLUGINS_FILE.read_text())
    matrix: dict = {"include": data["plugins"]}

    output_file: str | None = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a", encoding="utf-8") as f:
            f.write(f"matrix={json.dumps(matrix, separators=(',', ':'))}\n")

    print(json.dumps(matrix, indent=2))


def copy_skills_folder() -> None:
    """Copy skills/ into the plugin at DEST_PREFIX, then bump each configured
    version file in lock-step — but only if the copy actually produced changes.

    Required env:
      DEST_PREFIX    Prefix inside the plugin, may be empty.
                     e.g. "plugins/jfrog" -> skills/ lands at plugins/jfrog/skills/.

    Optional env:
      VERSION_BUMPS  JSON array of {file, path} entries.
                     Each entry points to a JSON file inside the plugin and a
                     dotted path to the semver field to patch-bump.
    """
    dest_prefix: str = os.environ.get("DEST_PREFIX", "").strip("/")
    bumps: list[dict] = json.loads(os.environ.get("VERSION_BUMPS", "[]") or "[]")

    src: Path = UPSTREAM_DIR / SOURCE
    if not src.exists():
        fail(f"upstream missing {SOURCE}/ at {src}")

    dest: Path = PLUGIN_DIR / dest_prefix / SOURCE if dest_prefix else PLUGIN_DIR / SOURCE
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dest)
    print(f"Copied {src} -> {dest.relative_to(PLUGIN_DIR)}")

    if not bumps:
        return
    if not has_changes(PLUGIN_DIR):
        print("No skill changes detected — skipping version bumps.")
        return
    for bump in bumps:
        bump_patch_version(PLUGIN_DIR / bump["file"], bump["path"])


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


def bump_patch_version(file_path: Path, dotted_path: str) -> None:
    data: dict = json.loads(file_path.read_text())

    # Convert numeric parts to int indices up front, e.g.
    # "plugins.0.version" -> ["plugins", 0, "version"].
    keys: list = [int(p) if p.isdigit() else p for p in dotted_path.split(".")]
    parent = data
    for key in keys[:-1]:
        parent = parent[key]
    leaf_key = keys[-1]

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
