// check: is the agent guidance still true? Compares the generated block with a
// fresh scan, verifies that commands and paths mentioned anywhere in the docs
// still exist, and catches setups where Claude Code silently ignores AGENTS.md.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findBlock, hash, normalize } from './blocks.mjs';
import { importsFile } from './docs.mjs';
import { readJson } from './files.mjs';
import { PLACEHOLDER, renderFacts } from './render.mjs';
import { docsAge, scan } from './scan.mjs';

const MAX_LINES = 200;

const PM_BUILTINS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'dlx', 'exec', 'x',
  'create', 'init', 'link', 'unlink', 'publish', 'pack', 'why', 'outdated', 'audit', 'list', 'ls', 'config',
  'store', 'info', 'view', 'version', 'login', 'logout', 'cache', 'workspace', 'workspaces', 'import', 'prune',
  'rebuild', 'env', 'help', 'set', 'dedupe', 'patch', 'patch-commit', 'licenses', 'fetch', 'node', 'global',
  'bin', 'root', 'search', 'whoami', 'owner', 'team', 'access', 'token', 'deprecate', 'dist-tag', 'fund',
  'doctor', 'explain', 'query', 'pkg', 'shrinkwrap', 'star', 'stars', 'pm',
]);
// bun has its own test runner and bundler: `bun test` and `bun build` are not scripts.
const BUN_BUILTINS = new Set(['test', 'build', 'x', 'upgrade', 'repl', 'init', 'create', 'pm', 'link', 'unlink', 'patch']);
const NPM_SCRIPT_BUILTINS = new Set(['test', 't', 'tst', 'start', 'stop', 'restart']);

const FILE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|py|go|rs|rb|java|kt|kts|swift|cs|php|yml|yaml|toml|sql|prisma|css|scss|html|sh|vue|svelte|astro|lock|ini|cfg|env\.example|txt|gradle|xml|proto|graphql|tf)$/i;
const GENERATED_DIRS = /^(dist|build|out|coverage|node_modules|\.next|\.nuxt|target|\.turbo|\.venv|venv|vendor)\//;
const KNOWN_ROOTS = new Set(['src', 'lib', 'app', 'apps', 'packages', 'test', 'tests', 'spec', 'e2e', 'docs', 'scripts',
  'components', 'pages', 'public', 'prisma', 'migrations', 'cmd', 'internal', 'pkg', 'config', '.github', '.claude',
  'server', 'client', 'api', 'tools', 'bin', 'examples', 'crates', 'services', 'infra', 'deploy', 'hooks', 'skills']);

function stripFences(doc) {
  // returns { inline: text with fenced blocks removed, fenced: lines inside fences }
  const inline = [];
  const fenced = [];
  let fence = false;
  for (const line of doc.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    (fence ? fenced : inline).push(line);
  }
  return { inline: inline.join('\n'), fenced };
}

function withoutBlock(doc) {
  const blk = findBlock(doc);
  if (!blk || blk.broken) return doc;
  return doc.slice(0, blk.start) + doc.slice(blk.end);
}

/** Commands and paths an agent would act on, pulled from Markdown. */
export function references(doc) {
  // A line can opt out with an HTML comment: <!-- repo-onboarding:ignore -->
  doc = doc.split(/\r?\n/).filter((l) => !l.includes('repo-onboarding:ignore')).join('\n');
  const { inline, fenced } = stripFences(doc);
  const spans = [...inline.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
  const commandSources = [...spans, ...fenced.map((l) => l.replace(/^\s*[$>]\s*/, '').trim())];
  const commands = [];
  for (const src of commandSources) {
    for (const part of src.split(/\s*(?:&&|\|\||;|\|)\s*/)) {
      const m = /^(?:npx\s+)?(npm|pnpm|yarn|bun|make|just|deno|composer)\s+(.*)$/.exec(part.trim());
      if (m) commands.push({ tool: m[1], args: m[2].trim().split(/\s+/), text: part.trim() });
    }
  }
  const paths = [];
  for (const s of spans) {
    let p = s.replace(/:\d+(:\d+)?$/, '').replace(/^\.\//, '');
    if (!/^[\w.@()[\]\-+][\w.@()[\]\-+/]*$/.test(p)) continue; // spaces, globs, vars, urls: not a plain path
    if (p.startsWith('@') || /^\d+(\.\d+)*$/.test(p) || /^\.env/.test(p) || p.includes('//')) continue;
    if (GENERATED_DIRS.test(p) || /\.local\.md$/.test(p)) continue;
    // Agent config folders are usually described generically ("a project's .claude/agents/").
    if (/^\.(claude|codex|agents|cursor|windsurf|vscode|idea)\//.test(p) && p.endsWith('/')) continue;
    const first = p.split('/')[0];
    const looksLikePath = (p.includes('/') && KNOWN_ROOTS.has(first)) || FILE_EXT.test(p);
    if (looksLikePath) paths.push(p);
  }
  return { commands, paths: [...new Set(paths)] };
}

function scriptsIndex(root, facts) {
  const scripts = new Set(Object.keys(readJson(root, 'package.json')?.scripts || {}));
  for (const p of facts.workspaces?.packages || []) {
    for (const s of Object.keys(readJson(root, `${p.path}/package.json`)?.scripts || {})) scripts.add(s);
  }
  const composer = new Set(Object.keys(readJson(root, 'composer.json')?.scripts || {}));
  const deno = new Set(Object.keys((readJson(root, 'deno.json') || readJson(root, 'deno.jsonc'))?.tasks || {}));
  return { scripts, composer, deno };
}

function verifyCommand(cmd, idx, facts) {
  const { tool, args } = cmd;
  // Leading flags (`pnpm --filter web dev`, `make -C dir test`) may take values;
  // rather than guess which word is the script, skip the check.
  if (!args[0] || args[0].startsWith('-')) return null;
  const a = args.filter((x) => !x.startsWith('-') || x === '--');
  const first = a[0];
  if (!first || first === '--') return null;
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(tool)) {
    if (!facts.packageManager && !idx.scripts.size) return null;
    let script = null;
    if (first === 'run' || first === 'run-script') script = a[1];
    else if (tool === 'npm') script = NPM_SCRIPT_BUILTINS.has(first) ? (first === 't' || first === 'tst' ? 'test' : first) : null;
    else if (tool === 'bun' && BUN_BUILTINS.has(first)) script = null;
    else if (!PM_BUILTINS.has(first)) script = first;
    if (!script || /[<>{}$*]/.test(script)) return null;
    if (!idx.scripts.has(script)) return `\`${cmd.text}\`: no "${script}" script in package.json`;
    return null;
  }
  if (tool === 'make') {
    if (/[<>{}$=]/.test(first)) return null;
    if (!facts.makeTargets.length) return `\`${cmd.text}\`: there is no Makefile`;
    return facts.makeTargets.includes(first) ? null : `\`${cmd.text}\`: no "${first}" target in the Makefile`;
  }
  if (tool === 'just') {
    if (/[<>{}$=]/.test(first)) return null;
    if (!facts.justRecipes.length) return `\`${cmd.text}\`: there is no justfile`;
    return facts.justRecipes.includes(first) ? null : `\`${cmd.text}\`: no "${first}" recipe in the justfile`;
  }
  if (tool === 'composer' && first === 'run' && a[1]) {
    return idx.composer.has(a[1]) ? null : `\`${cmd.text}\`: no "${a[1]}" script in composer.json`;
  }
  if (tool === 'deno' && first === 'task' && a[1]) {
    return idx.deno.has(a[1]) ? null : `\`${cmd.text}\`: no "${a[1]}" task in deno.json`;
  }
  return null;
}

function lineDiff(oldText, newText) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const setA = new Set(a);
  const setB = new Set(b);
  const removed = a.filter((l) => l.trim() && !setB.has(l)).map((l) => `- ${l}`);
  const added = b.filter((l) => l.trim() && !setA.has(l)).map((l) => `+ ${l}`);
  return [...removed, ...added];
}

/**
 * @returns {{ok: boolean, findings: {level: 'error'|'warn'|'info', code: string, message: string, detail?: string[]}[], file: string}}
 */
export function check(dir, opts = {}) {
  const file = opts.file || 'AGENTS.md';
  const facts = scan(dir);
  const root = facts.root;
  const findings = [];
  const add = (level, code, message, detail) => findings.push({ level, code, message, ...(detail?.length ? { detail } : {}) });

  const docPath = join(root, file);
  const claudePath = join(root, 'CLAUDE.md');
  const doc = existsSync(docPath) ? readFileSync(docPath, 'utf8') : null;
  const claude = file !== 'CLAUDE.md' && existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : null;

  if (doc == null) {
    add('error', 'missing', `${file} not found. Run \`repo-onboarding init\` to create it.`);
    return { ok: false, findings, file };
  }

  const blk = findBlock(doc);
  if (!blk) {
    add('warn', 'no-block', `${file} has no generated block, so its commands and layout are not checked against the repository. Run \`repo-onboarding init\` to add one.`);
  } else if (blk.broken) {
    add('error', 'broken-block', `${file} has a "repo-onboarding:begin" marker without a matching end marker.`);
  } else {
    const fresh = normalize(renderFacts(facts));
    if (blk.content !== fresh) {
      const age = docsAge(root, file);
      const detail = lineDiff(blk.content, fresh).slice(0, 14);
      add('error', 'stale', `The generated block in ${file} no longer matches the repository${age ? ` (${age} commit${age === 1 ? '' : 's'} changed build files since ${file} was last edited)` : ''}. Run \`repo-onboarding update\`.`, detail);
    }
    if (blk.sha && blk.sha !== hash(blk.content)) {
      add('warn', 'edited', `The generated block in ${file} was edited by hand. \`repo-onboarding update\` will replace those edits; move them outside the block.`);
    }
  }

  // Claude Code loads CLAUDE.md *instead of* AGENTS.md when both exist.
  if (file === 'AGENTS.md' && claude != null && !importsFile(claude, 'AGENTS.md')) {
    add('error', 'claude-ignores-agents', 'CLAUDE.md exists but does not import AGENTS.md, so Claude Code never reads AGENTS.md. Add a line `@AGENTS.md` to CLAUDE.md, or run `repo-onboarding init`.');
  }

  // Commands and paths mentioned by hand (the generated block is checked above).
  const idx = scriptsIndex(root, facts);
  const docs = [[file, withoutBlock(doc)], ...(claude != null ? [['CLAUDE.md', claude]] : [])];
  const badCmds = [];
  const badPaths = [];
  for (const [name, text] of docs) {
    const refs = references(text);
    for (const c of refs.commands) {
      const problem = verifyCommand(c, idx, facts);
      if (problem) badCmds.push(`${name}: ${problem}`);
    }
    for (const p of refs.paths) {
      const fileSet = facts._files;
      const found = existsSync(join(root, p)) || (!p.includes('/') && fileSet?.some((f) => f.endsWith(`/${p}`)));
      if (!found) badPaths.push(`${name}: \`${p}\``);
    }
  }
  if (badCmds.length) add('error', 'unknown-command', `${badCmds.length} command${badCmds.length === 1 ? '' : 's'} in the docs no longer exist${badCmds.length === 1 ? 's' : ''}.`, [...new Set(badCmds)]);
  if (badPaths.length) add('warn', 'missing-path', `${badPaths.length} path${badPaths.length === 1 ? '' : 's'} mentioned in the docs could not be found.`, [...new Set(badPaths)]);

  const placeholders = (doc.match(new RegExp(PLACEHOLDER.replace(/[()]/g, '\\$&'), 'g')) || []).length;
  if (placeholders) add('warn', 'placeholder', `${file} still has ${placeholders} ${PLACEHOLDER} placeholder${placeholders === 1 ? '' : 's'}. Ask your agent to run the onboard skill, or fill them in.`);

  const lines = doc.split(/\r?\n/).length + (claude ? claude.split(/\r?\n/).length : 0);
  if (lines > MAX_LINES) add('warn', 'too-long', `${file}${claude ? ' and CLAUDE.md are' : ' is'} ${lines} lines. Agents load this every session; Anthropic recommends under ${MAX_LINES}. Move rarely needed detail into linked docs.`);

  const ok = !findings.some((f) => f.level === 'error') && !(opts.strict && findings.some((f) => f.level === 'warn'));
  return { ok, findings, file };
}
