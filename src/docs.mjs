// init and update: write AGENTS.md (and a CLAUDE.md that imports it) without
// ever overwriting text people wrote. Only the generated block is replaced.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findBlock, replaceBlock, wrap } from './blocks.mjs';
import { agentsTemplate, claudeTemplate, renderFacts } from './render.mjs';
import { scan } from './scan.mjs';

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

/** True when the file imports `target` with an `@path` line Claude Code will expand. */
export function importsFile(doc, target) {
  if (!doc) return false;
  let fence = false;
  for (const line of doc.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const noCode = line.replace(/`[^`]*`/g, '');
    const re = new RegExp(`(^|\\s)@(\\./)?${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    if (re.test(noCode)) return true;
  }
  return false;
}

/** Insert the generated block before the first second-level heading, or append it. */
function insertBlock(doc, block) {
  const m = /^## /m.exec(doc);
  if (!m) return `${doc.trimEnd()}\n\n${block}\n`;
  return `${doc.slice(0, m.index)}${block}\n\n${doc.slice(m.index)}`;
}

function addImport(doc, target) {
  const line = `@${target}`;
  const lines = doc.split(/\r?\n/);
  const h1 = lines.findIndex((l) => /^# /.test(l));
  if (h1 === -1) return `${line}\n\n${doc}`;
  lines.splice(h1 + 1, 0, '', line);
  return lines.join('\n');
}

/**
 * @param {string} dir repository root
 * @param {{file?: string, claude?: boolean, dryRun?: boolean}} opts
 * @returns {{facts: object, actions: {path: string, action: string}[], files: Record<string,string>}}
 */
export function init(dir, opts = {}) {
  const file = opts.file || 'AGENTS.md';
  const facts = scan(dir);
  const block = wrap(renderFacts(facts));
  const actions = [];
  const files = {};
  const target = join(facts.root, file);
  const existing = read(target);

  if (existing == null) {
    files[file] = file === 'AGENTS.md' ? agentsTemplate(facts, block) : `# ${file.replace(/\.md$/, '')}\n\n${block}\n`;
    actions.push({ path: file, action: 'created' });
  } else {
    const blk = findBlock(existing);
    if (blk?.broken) throw new Error(`${file} has a "repo-onboarding:begin" marker without a matching end marker. Fix or remove it, then run again.`);
    if (blk) {
      const next = replaceBlock(existing, renderFacts(facts));
      if (next !== existing) {
        files[file] = next;
        actions.push({ path: file, action: 'updated generated block' });
      } else actions.push({ path: file, action: 'up to date' });
    } else {
      files[file] = insertBlock(existing, block);
      actions.push({ path: file, action: 'added generated block' });
    }
  }

  // Claude Code reads CLAUDE.md instead of AGENTS.md whenever a CLAUDE.md exists,
  // so a CLAUDE.md must import AGENTS.md or Claude never sees it.
  if (file === 'AGENTS.md' && opts.claude !== false) {
    const claudePath = join(facts.root, 'CLAUDE.md');
    const claude = read(claudePath);
    if (claude == null) {
      files['CLAUDE.md'] = claudeTemplate();
      actions.push({ path: 'CLAUDE.md', action: 'created (imports AGENTS.md)' });
    } else if (!importsFile(claude, 'AGENTS.md')) {
      files['CLAUDE.md'] = addImport(claude, 'AGENTS.md');
      actions.push({ path: 'CLAUDE.md', action: 'added @AGENTS.md import' });
    } else actions.push({ path: 'CLAUDE.md', action: 'already imports AGENTS.md' });
  }

  if (!opts.dryRun) for (const [rel, text] of Object.entries(files)) writeFileSync(join(facts.root, rel), text);
  return { facts, actions, files };
}

/** Refresh only the generated block. Fails when there is no block to refresh. */
export function update(dir, opts = {}) {
  const file = opts.file || 'AGENTS.md';
  const facts = scan(dir);
  const target = join(facts.root, file);
  const existing = read(target);
  if (existing == null) throw new Error(`${file} not found. Run \`repo-onboarding init\` first.`);
  const blk = findBlock(existing);
  if (!blk) throw new Error(`${file} has no generated block. Run \`repo-onboarding init\` to add one.`);
  if (blk.broken) throw new Error(`${file} has a begin marker without an end marker.`);
  const next = replaceBlock(existing, renderFacts(facts));
  const changed = next !== existing;
  if (changed && !opts.dryRun) writeFileSync(target, next);
  return { facts, changed, file, text: next };
}

