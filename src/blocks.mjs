// The generated part of AGENTS.md lives between two HTML comments. Everything
// outside them belongs to people and agents and is never touched.
import { createHash } from 'node:crypto';

const BEGIN_RE = /<!--\s*repo-onboarding:begin(?:\s+sha=([0-9a-f]+))?[^>]*-->/;
const END_RE = /<!--\s*repo-onboarding:end\s*-->/;

export const hash = (text) => createHash('sha256').update(normalize(text)).digest('hex').slice(0, 12);

function normalize(text) {
  return text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
}

export function wrap(content) {
  const body = normalize(content);
  return `<!-- repo-onboarding:begin sha=${hash(body)} · generated from the repository; edit outside this block, refresh with \`repo-onboarding update\` -->\n${body}\n<!-- repo-onboarding:end -->`;
}

/** Locate the block. Returns null when absent. */
export function findBlock(doc) {
  const b = BEGIN_RE.exec(doc);
  if (!b) return null;
  const rest = doc.slice(b.index + b[0].length);
  const e = END_RE.exec(rest);
  if (!e) return { start: b.index, end: -1, sha: b[1] || null, content: null, broken: true };
  const end = b.index + b[0].length + e.index + e[0].length;
  return {
    start: b.index,
    end,
    sha: b[1] || null,
    content: normalize(rest.slice(0, e.index)),
    broken: false,
  };
}

export function replaceBlock(doc, content) {
  const blk = findBlock(doc);
  if (!blk || blk.broken) return null;
  return doc.slice(0, blk.start) + wrap(content) + doc.slice(blk.end);
}

export { normalize };
