"""Unit tests for .github/scripts/jfrog-sync-plugins.py (stdlib unittest)."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / ".github" / "scripts" / "jfrog-sync-plugins.py"


def load_sync_module():
    spec = importlib.util.spec_from_file_location("jfrog_sync_plugins", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


sync = load_sync_module()


class TestPluginsJsonPinUpdates(unittest.TestCase):
    def test_skills_vendor_pins_are_configured(self):
        data = json.loads((REPO_ROOT / ".github" / "plugins.json").read_text())
        by_name = {p["name"]: p for p in data["plugins"]}

        self.assertEqual(
            by_name["claude-plugin"]["pin_updates"],
            [{"file": ".github/scripts/sync-skills-vendor.json", "path": "pin"}],
        )
        self.assertEqual(
            by_name["cursor-plugin"]["pin_updates"],
            [{"file": ".github/scripts/sync-skills-vendor.json", "path": "pin"}],
        )
        self.assertEqual(
            by_name["codex-plugin"]["pin_updates"],
            [{"file": "scripts/sync-skills-vendor.json", "path": "pin"}],
        )
        self.assertEqual(
            by_name["opencode-jfrog-plugin"]["pin_updates"],
            [{"file": "sync-skills-vendor.json", "path": "pin"}],
        )
        self.assertEqual(
            by_name["jfrog-kiro-power"]["pin_updates"],
            [{"file": "scripts/sync-skills-vendor.json", "path": "pin"}],
        )
        self.assertEqual(
            by_name["devin-plugin"]["pin_updates"],
            [{"file": ".github/scripts/sync-skills-vendor.json", "path": "pin"}],
        )
        self.assertEqual(
            by_name["jetbrains-plugin"]["pin_updates"],
            [{"file": ".github/scripts/sync-skills-vendor.json", "path": "pin"}],
        )
        self.assertEqual(by_name["jetbrains-plugin"]["dest_prefix"], ".junie")


class TestCopyPinUpdates(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        root = Path(self._tmpdir.name)

        self.plugin = root / "plugin"
        self.plugin.mkdir()
        subprocess.run(["git", "init"], cwd=self.plugin, check=True, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=self.plugin,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "test"],
            cwd=self.plugin,
            check=True,
            capture_output=True,
        )

        skills = self.plugin / "skills" / "demo"
        skills.mkdir(parents=True)
        (skills / "SKILL.md").write_text("name: demo\n")

        vendor = self.plugin / ".github" / "scripts"
        vendor.mkdir(parents=True)
        (vendor / "sync-skills-vendor.json").write_text(
            json.dumps(
                {"repo": "jfrog/jfrog-skills", "pin": "v0.11.0", "paths": ["skills"]}
            )
            + "\n"
        )
        (self.plugin / "plugin.json").write_text(json.dumps({"version": "1.0.0"}) + "\n")

        subprocess.run(["git", "add", "."], cwd=self.plugin, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "init"],
            cwd=self.plugin,
            check=True,
            capture_output=True,
        )

        self.upstream = root / "upstream"
        skill = self.upstream / "skills" / "demo"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("name: demo\nupdated: true\n")

        self._orig_plugin_dir = sync.PLUGIN_DIR
        self._orig_upstream_dir = sync.UPSTREAM_DIR
        sync.PLUGIN_DIR = self.plugin
        sync.UPSTREAM_DIR = self.upstream

        self._env_backup = {
            key: os.environ.get(key)
            for key in ("DEST_PREFIX", "VERSION", "PIN_UPDATES", "VERSION_BUMPS")
        }

    def tearDown(self):
        sync.PLUGIN_DIR = self._orig_plugin_dir
        sync.UPSTREAM_DIR = self._orig_upstream_dir
        for key, value in self._env_backup.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmpdir.cleanup()

    def test_set_json_value_updates_pin(self):
        path = self.plugin / ".github" / "scripts" / "sync-skills-vendor.json"
        sync.set_json_value(path, "pin", "v0.22.0")
        self.assertEqual(json.loads(path.read_text())["pin"], "v0.22.0")

    def test_copy_updates_pin_and_bumps_version(self):
        os.environ["DEST_PREFIX"] = ""
        os.environ["VERSION"] = "v0.22.0"
        os.environ["PIN_UPDATES"] = json.dumps(
            [{"file": ".github/scripts/sync-skills-vendor.json", "path": "pin"}]
        )
        os.environ["VERSION_BUMPS"] = json.dumps(
            [{"file": "plugin.json", "path": "version"}]
        )

        sync.copy_skills_folder()

        pin = json.loads(
            (self.plugin / ".github" / "scripts" / "sync-skills-vendor.json").read_text()
        )
        self.assertEqual(pin["pin"], "v0.22.0")
        self.assertEqual(
            (self.plugin / "skills" / "demo" / "SKILL.md").read_text(),
            "name: demo\nupdated: true\n",
        )
        self.assertEqual(
            json.loads((self.plugin / "plugin.json").read_text())["version"],
            "1.0.1",
        )

    def test_copy_requires_version_when_pins_configured(self):
        os.environ["DEST_PREFIX"] = ""
        os.environ.pop("VERSION", None)
        os.environ["PIN_UPDATES"] = json.dumps(
            [{"file": ".github/scripts/sync-skills-vendor.json", "path": "pin"}]
        )
        os.environ["VERSION_BUMPS"] = "[]"

        with self.assertRaises(SystemExit):
            sync.copy_skills_folder()


if __name__ == "__main__":
    unittest.main()
