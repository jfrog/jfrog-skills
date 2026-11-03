#!/usr/bin/env node
// jfrog-remove-skill.mjs — delete an installed skill's directory.
//
//   node jfrog-remove-skill.mjs --slug <slug> --install-dir <dir>
//
// The slug comes from `jf skills list`, so it must be a plain name. No shell is
// used. Exit: 0 removed | 1 not installed | 2 usage error | 3 invalid slug.
// On 1 and 3, stderr is one line to show the user.

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

let values = {};
try {
  ({ values } = parseArgs({ options: { slug: { type: 'string' }, 'install-dir': { type: 'string' } } }));
} catch {}
const { slug, 'install-dir': installDir } = values;
if (!slug || !installDir) fail(2, 'usage: jfrog-remove-skill.mjs --slug <slug> --install-dir <dir>');

// Letters, digits, "." "_" "-", starting with a letter or digit (so never "." / ".." / "-x").
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) fail(3, "That skill name isn't valid, so I can't remove it.");

const target = join(installDir, slug);
if (!existsSync(target)) fail(1, 'Not installed, nothing to remove');
rmSync(target, { recursive: true });
