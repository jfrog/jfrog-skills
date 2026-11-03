#!/usr/bin/env node
// jfrog-update-skill.mjs — update an installed skill, only from a repo that is
// still governance-allowed.
//
//   node jfrog-update-skill.mjs --slug <slug> --install-dir <dir> --server-id <SID> \
//     --project <PROJECT> <target> [--dry-run] [--force]
//   <target>: --harness <h> [--global | --project-dir <dir>] | --global | --project-dir <dir>
//             | --path <dir>
//
// The repo comes from <install-dir>/<slug>/.jfrog/skill-info.json, which any
// project can commit, so it is untrusted: it must be a plain id and appear in
// the project's `--allowed-only` listing. No shell is used (spawnSync,
// shell:false), so a value is only ever one argument. The one exception is npx
// on Windows (see runNpx).
//
// Exit: 0 updated | 1 failed | 2 usage error | 3 refused (unsafe or not allowed)
// On 1 and 3, stderr is one line to show the user. `jf` output passes through.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_REGISTRY = 'https://releases.jfrog.io/artifactory/api/npm/coding-agents-npm/';
const MAX_PAGES = 20;
const REQUIRED_FLAGS = ['--slug', '--install-dir', '--server-id', '--project'];
const TARGET_FLAGS = ['--harness', '--project-dir', '--path'];
const VALUE_FLAGS = [...REQUIRED_FLAGS, ...TARGET_FLAGS];
const BOOL_FLAGS = ['--global', '--dry-run', '--force'];
// A plain id: letters, digits, "." "_" "-". Never "." / "..", never a leading "-".
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const USAGE =
  'usage: jfrog-update-skill.mjs --slug <slug> --install-dir <dir> --server-id <SID> ' +
  '--project <PROJECT> <target> [--dry-run] [--force]\n' +
  '<target>: --harness <h> [--global | --project-dir <dir>] | --global | --project-dir <dir> | --path <dir>';

// An error with the exit code to finish with.
class Stop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const listingError = (reason) =>
  new Stop(1, `Could not check the allowed repositories${reason ? `: ${reason}` : ''}`);

function isSafeId(value) {
  return (
    typeof value === 'string' &&
    SAFE_ID.test(value) &&
    value !== '.' &&
    value !== '..' &&
    !value.startsWith('-')
  );
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (BOOL_FLAGS.includes(flag)) {
      args[flag] = true;
    } else if (VALUE_FLAGS.includes(flag)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new Stop(2, `${flag} requires a value\n${USAGE}`);
      }
      args[flag] = value.trim();
    } else {
      throw new Stop(2, `unknown argument: ${flag}\n${USAGE}`);
    }
  }
  for (const flag of REQUIRED_FLAGS) {
    if (!args[flag]) throw new Stop(2, `${flag} is required\n${USAGE}`);
  }

  // --path stands alone; otherwise any mix of --harness / --project-dir / --global
  // (at least one). `jf` rejects combinations it doesn't support.
  const targets = TARGET_FLAGS.filter((flag) => args[flag]);
  const validTarget = args['--path']
    ? targets.length === 1 && !args['--global']
    : targets.length > 0 || args['--global'];
  if (!validTarget) throw new Stop(2, `invalid install target\n${USAGE}`);

  if (!isSafeId(args['--slug'])) throw new Stop(3, "That skill name isn't valid, so I can't update it.");
  return args;
}

// Never prints the file's value: it is untrusted.
function readInstalledRepo(installDir, slug) {
  let repo;
  try {
    repo = JSON.parse(readFileSync(join(installDir, slug, '.jfrog', 'skill-info.json'), 'utf8')).repo;
  } catch {
    // A missing or unreadable file is handled like a missing repo.
  }
  if (!isSafeId(repo)) {
    throw new Stop(3, "I can't safely tell which repo this skill was installed from, so I can't update it.");
  }
  return repo;
}

function lastErrorLine(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('Trace ID'));
  return lines[lines.length - 1] ?? '';
}

// Windows runs npx as npx.cmd, which only works through cmd.exe. reject cmd
// metacharacters in the arguments and pass one quoted command string.
const CMD_UNSAFE = /[&|;$<>`"'%^!\r\n]/;

function runNpx(args, options) {
  if (process.platform !== 'win32') return spawnSync('npx', args, options);
  if (args.some((arg) => CMD_UNSAFE.test(arg))) throw listingError('unsafe argument');
  const command = ['npx', ...args.map((arg) => `"${arg}"`)].join(' ');
  return spawnSync(command, { ...options, shell: process.env.ComSpec || 'cmd.exe' });
}

function fetchPage({ slug, project, serverId }, cursor) {
  const registry = process.env.JFROG_AGENT_GUARD_REPO || DEFAULT_REGISTRY;
  const cursorArgs = cursor ? ['--cursor', cursor] : [];
  const result = runNpx(
    [
      '--yes', '--registry', registry, '@jfrog/agent-guard',
      '--list-skill-versions', '--project', project, '--skill', slug, '--allowed-only',
      '--server', serverId, '--format', 'json', ...cursorArgs,
    ],
    { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.error || result.status !== 0) throw listingError(lastErrorLine(result.stderr));
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    throw listingError('unreadable response');
  }
}

// Every allowed repo that hosts the slug. An incomplete listing is an error:
// the repo we need could be on a page we never read.
function listAllowedRepos(query) {
  const repos = new Set();
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = fetchPage(query, cursor);
    for (const version of data.versions ?? []) {
      for (const location of version.locations ?? []) {
        if (typeof location.repoKey === 'string') repos.add(location.repoKey);
      }
    }
    if (data.exhausted === true) return repos;
    if (!data.cursor) throw listingError('incomplete listing');
    cursor = data.cursor;
  }
  throw listingError('too many pages');
}

function targetArgs(args) {
  const flags = TARGET_FLAGS.filter((flag) => args[flag]).flatMap((flag) => [flag, args[flag]]);
  return args['--global'] ? [...flags, '--global'] : flags;
}

function runUpdate(args, repo) {
  // Always --quiet: an agent shell has no TTY, so a prompt would fail.
  const mode = args['--dry-run']
    ? ['--dry-run', '--quiet']
    : ['--version', 'latest', '--quiet', ...(args['--force'] ? ['--force'] : [])];
  process.stdout.write(`Updating from repo: ${repo}\n`);
  const result = spawnSync(
    'jf',
    [
      'skills', 'update', args['--slug'],
      '--server-id', args['--server-id'],
      ...targetArgs(args),
      '--repo', repo,
      ...mode,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw new Stop(1, 'Could not run the jf CLI');
  // jf's own exit codes must not be read as 2 or 3.
  process.exitCode = result.status === 0 ? 0 : 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const slug = args['--slug'];

  const repo = readInstalledRepo(args['--install-dir'], slug);
  const allowed = listAllowedRepos({ slug, project: args['--project'], serverId: args['--server-id'] });
  if (!allowed.has(repo)) {
    throw new Stop(
      3,
      `\`${slug}\` is installed from \`${repo}\`, which is not governance-allowed for this project, so I can't update it.`,
    );
  }
  runUpdate(args, repo);
}

// Set exitCode instead of exiting, so pending output is flushed.
try {
  main();
} catch (error) {
  if (error instanceof Stop) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.code;
  } else {
    process.stderr.write('Updating the skill failed: an unexpected error occurred.\n');
    process.exitCode = 1;
  }
}
