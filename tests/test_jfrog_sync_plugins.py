"""Unit tests for .github/scripts/jfrog-sync-plugins.py (stdlib unittest)."""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
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

    def test_copy_rewrites_readme_aliases_without_version_bumps(self):
        os.environ["DEST_PREFIX"] = ""
        os.environ["VERSION"] = "v0.31.1"
        os.environ["PIN_UPDATES"] = "[]"
        os.environ["VERSION_BUMPS"] = "[]"

        (self.plugin / "README.md").write_text(
            "# Features\n"
            "| **Skill** | Package safety & download | Check packages. |\n"
            "### Package safety & download skill\n"
            "See `jfrog-package-safety-and-download` and `jfrog-ai-catalog-skills`.\n"
            "Also `#jfrog-ai-catalog-skills-references`.\n"
            "Pin: https://github.com/jfrog/jfrog-skills/blob/v0.11.0/README.md#requirements\n"
            "Vendored at v0.11.0 (pinned at `v0.11.0`).\n"
        )
        (self.plugin / "skills" / "jfrog-package-safety-and-download").mkdir()
        (self.plugin / "skills" / "jfrog-ai-catalog-skills").mkdir()

        skill = self.upstream / "skills"
        (skill / "jfrog-package-curation").mkdir()
        (skill / "jfrog-package-curation" / "SKILL.md").write_text("name: jfrog-package-curation\n")
        (skill / "jfrog-ai-catalog").mkdir()
        (skill / "jfrog-ai-catalog" / "SKILL.md").write_text("name: jfrog-ai-catalog\n")
        (skill / "demo").mkdir(parents=True, exist_ok=True)

        sync.copy_skills_folder()

        readme = (self.plugin / "README.md").read_text()
        self.assertIn("Package curation", readme)
        self.assertNotIn("Package safety & download", readme)
        self.assertIn("`jfrog-package-curation`", readme)
        self.assertIn("`jfrog-ai-catalog`", readme)
        self.assertIn("`#jfrog-ai-catalog-references`", readme)
        self.assertNotIn("jfrog-package-safety-and-download", readme)
        self.assertNotIn("jfrog-ai-catalog-skills", readme)
        self.assertIn(
            "https://github.com/jfrog/jfrog-skills/blob/v0.31.1/README.md#requirements",
            readme,
        )
        self.assertIn("pinned at `v0.31.1`", readme)
        self.assertTrue((self.plugin / "skills" / "jfrog-package-curation").is_dir())
        self.assertFalse(
            (self.plugin / "skills" / "jfrog-package-safety-and-download").exists()
        )


class TestRewritePluginSkillDocs(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.root = Path(self._tmpdir.name)
        self.plugin = self.root / "plugin"
        self.plugin.mkdir()
        skills = self.plugin / "skills"
        (skills / "jfrog-package-curation").mkdir(parents=True)
        (skills / "jfrog-ai-catalog").mkdir()

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_skips_alias_when_new_dir_absent(self):
        shutil.rmtree(self.plugin / "skills" / "jfrog-package-curation")
        readme = self.plugin / "README.md"
        readme.write_text("see jfrog-package-safety-and-download and jfrog-ai-catalog-skills\n")

        changed = sync.rewrite_plugin_skill_docs(self.plugin, "", "v0.31.1")
        text = readme.read_text()
        self.assertIn("jfrog-package-safety-and-download", text)
        self.assertIn("jfrog-ai-catalog", text)
        self.assertNotIn("jfrog-ai-catalog-skills", text)
        self.assertGreaterEqual(changed, 1)

    def test_does_not_rewrite_files_under_skills(self):
        leaked = self.plugin / "skills" / "jfrog-package-curation" / "NOTES.md"
        leaked.write_text("historical name jfrog-package-safety-and-download\n")
        (self.plugin / "README.md").write_text("ok\n")

        sync.rewrite_plugin_skill_docs(self.plugin, "", "")
        self.assertEqual(
            leaked.read_text(),
            "historical name jfrog-package-safety-and-download\n",
        )

    def test_rewrites_dest_prefix_readme(self):
        nested = self.plugin / "plugins" / "jfrog"
        nested.mkdir(parents=True)
        skills = nested / "skills"
        (skills / "jfrog-package-curation").mkdir(parents=True)
        (skills / "jfrog-ai-catalog").mkdir()
        readme = nested / "README.md"
        readme.write_text(
            "The **jfrog-ai-catalog-skills** skill (`skills/jfrog-ai-catalog-skills/`)\n"
        )
        shutil.rmtree(self.plugin / "skills")

        changed = sync.rewrite_plugin_skill_docs(self.plugin, "plugins/jfrog", "")
        self.assertEqual(changed, 1)
        self.assertIn("jfrog-ai-catalog", readme.read_text())
        self.assertNotIn("jfrog-ai-catalog-skills", readme.read_text())


if __name__ == "__main__":
    unittest.main()
