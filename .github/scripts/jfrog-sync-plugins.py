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
import sys
from pathlib import Path

PLUGINS_FILE = Path(".github/plugins.json")
SOURCE = "skills"                # the directory under jfrog-skills we vendor into each plugin
UPSTREAM_DIR = Path("upstream")  # sibling checkout of jfrog-skills@version (set by the workflow)
PLUGIN_DIR = Path("plugin")      # sibling checkout of the target plugin repo (set by the workflow)
USAGE = "usage: jfrog-sync-plugins.py matrix|copy"


def fail(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)
    sys.exit(1)


def cmd_matrix() -> None:
    """Emit a GitHub Actions matrix from .github/plugins.json.

    Writes `matrix=<compact-json>` to $GITHUB_OUTPUT (the per-step output
    file the runner provides automatically) and prints the matrix to
    stdout for the run log.

    Example input (.github/plugins.json):
        {
          "plugins": [
            { "name": "claude-plugin", "dest_prefix": "" },
            { "name": "cursor-plugin", "dest_prefix": "plugins/jfrog" }
          ]
        }

    Example output (appended to $GITHUB_OUTPUT):
        matrix={"include":[{"name":"claude-plugin","dest_prefix":""},{"name":"cursor-plugin","dest_prefix":"plugins/jfrog"}]}
    """
    data = json.loads(PLUGINS_FILE.read_text())
    matrix = {"include": data["plugins"]}

    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a", encoding="utf-8") as f:
            f.write(f"matrix={json.dumps(matrix, separators=(',', ':'))}\n")

    print(json.dumps(matrix, indent=2))


def cmd_copy() -> None:
    """Copy this repo's `skills/` into a plugin checkout at DEST_PREFIX.

    Removes any existing destination first so the result matches upstream
    exactly (no stale files left behind).

    Required env:
      DEST_PREFIX  Prefix inside the plugin, may be empty.

    Example (cursor-plugin layout, DEST_PREFIX=plugins/jfrog):
      copies upstream/skills -> plugin/plugins/jfrog/skills

    Example (claude-plugin layout, DEST_PREFIX=""):
      copies upstream/skills -> plugin/skills
    """
    # strip("/") tolerates "plugins/jfrog", "/plugins/jfrog/", and "" identically.
    dest_prefix = os.environ.get("DEST_PREFIX", "").strip("/")

    src_path = UPSTREAM_DIR / SOURCE
    if not src_path.exists():
        fail(f"upstream missing {SOURCE}/ at {src_path}")

    dest = PLUGIN_DIR / dest_prefix / SOURCE if dest_prefix else PLUGIN_DIR / SOURCE
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src_path, dest)
    print(f"Copied {src_path} -> {dest.relative_to(PLUGIN_DIR)}")


def main() -> None:
    # sys.argv[0] is the script path; sys.argv[1] is the first real argument.
    # We expect exactly one argument: either "matrix" or "copy".
    command = sys.argv[1] if len(sys.argv) == 2 else ""

    if command == "matrix":
        cmd_matrix()
    elif command == "copy":
        cmd_copy()
    else:
        fail(USAGE)


if __name__ == "__main__":
    main()
