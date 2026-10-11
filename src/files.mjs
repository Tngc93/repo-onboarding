// Repository file access: one listing of tracked + untracked-but-not-ignored
// files, and small safe readers. Everything is relative to the repo root.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

// Directories never worth describing, even when a repo forgot to ignore them.
export const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.venv', 'venv',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.gradle', '.idea',
  '.terraform', '.vercel', '.netlify', '.expo', 'Pods', 'DerivedData', '.dart_tool',
]);

// Usually build output. Only skipped when there is no git to tell us what is ignored.
const WALK_SKIP = new Set([...SKIP_DIRS, 'dist', 'build', 'out', 'coverage', 'target', 'vendor', 'bin', 'obj']);

const MAX_FILES = 50000;

function gitList(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
    });
    const files = out.split('\0').filter(Boolean);
    return files.length ? files : null;
  } catch {
    return null;
  }
}

function walk(root) {
  const files = [];
  const stack = [''];
  while (stack.length && files.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!WALK_SKIP.has(e.name)) stack.push(p);
      } else if (e.isFile()) {
        files.push(p);
      }
    }
  }
  return files.sort();
}

/** All files in the repository, as forward-slash relative paths, ignored files excluded. */
export function listFiles(root) {
  const files = gitList(root) ?? walk(root);
  return files
    .map((f) => f.split(sep).join('/'))
    .filter((f) => !f.split('/').some((part) => SKIP_DIRS.has(part)))
    .slice(0, MAX_FILES);
}

export function readText(root, rel, max = 512 * 1024) {
  const p = join(root, rel);
  try {
    if (!statSync(p).isFile() || statSync(p).size > max) return null;
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export function readJson(root, rel) {
  const text = readText(root, rel);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function exists(root, rel) {
  return existsSync(join(root, rel));
}

/** Number of commits that touched `rel` since `sinceRel` was last changed, or null without git. */
export function commitsSince(root, sinceRel, paths) {
  try {
    const last = execFileSync('git', ['log', '-1', '--format=%H', '--', sinceRel], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!last) return null;
    const out = execFileSync('git', ['rev-list', '--count', `${last}..HEAD`, '--', ...paths], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return Number(out);
  } catch {
    return null;
  }
}
