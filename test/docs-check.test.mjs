import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixture, nodeRepo, write } from './helpers.mjs';
import { init, update, importsFile } from '../src/docs.mjs';
import { check, references } from '../src/check.mjs';
import { findBlock, hash } from '../src/blocks.mjs';
import { sessionStart } from '../src/hook.mjs';

const CLI = fileURLToPath(new URL('../cli/repo-onboarding.mjs', import.meta.url));
const read = (root, f) => readFileSync(join(root, f), 'utf8');
const codes = (r) => r.findings.map((f) => f.code).sort();
const pkg = (root) => JSON.parse(read(root, 'package.json'));
const setPkg = (root, p) => writeFileSync(join(root, 'package.json'), JSON.stringify(p, null, 2));

// ------------------------------------------------------------------ init / update
test('init on a bare repo writes AGENTS.md and a CLAUDE.md that imports it', () => {
  const root = fixture(nodeRepo());
  const r = init(root);
  assert.deepEqual(r.actions.map((a) => a.path), ['AGENTS.md', 'CLAUDE.md']);
  const agents = read(root, 'AGENTS.md');
  assert.match(agents, /^# AGENTS\.md/);
  assert.match(agents, /A small storefront\./); // description from package.json fills "Project"
  assert.match(agents, /\| Test \| `pnpm test` \| package\.json \|/);
  assert.ok(findBlock(agents));
  assert.ok(importsFile(read(root, 'CLAUDE.md'), 'AGENTS.md'));
});

test('init is idempotent', () => {
  const root = fixture(nodeRepo());
  init(root);
  const before = read(root, 'AGENTS.md');
  const r = init(root);
  assert.equal(read(root, 'AGENTS.md'), before);
  assert.deepEqual(r.actions.map((a) => a.action), ['up to date', 'already imports AGENTS.md']);
});

test('init keeps an existing CLAUDE.md and only adds the import under its title', () => {
  const root = fixture({ ...nodeRepo(), 'CLAUDE.md': '# Rules\n\nAlways use server actions.\n' });
  init(root);
  assert.equal(read(root, 'CLAUDE.md'), '# Rules\n\n@AGENTS.md\n\nAlways use server actions.\n');
  init(root);
  assert.equal(read(root, 'CLAUDE.md').match(/@AGENTS\.md/g).length, 1);
});

test('init adds the block to an existing AGENTS.md without touching human text', () => {
  const human = '# Guide\n\nIntro written by a person.\n\n## Conventions\n\nUse tabs.\n';
  const root = fixture({ ...nodeRepo(), 'AGENTS.md': human });
  init(root, { claude: false });
  const doc = read(root, 'AGENTS.md');
  assert.ok(doc.startsWith('# Guide\n\nIntro written by a person.\n\n<!-- repo-onboarding:begin'));
  assert.ok(doc.endsWith('## Conventions\n\nUse tabs.\n'));
  assert.equal(existsSync(join(root, 'CLAUDE.md')), false);
});

test('update rewrites only the block', () => {
  const root = fixture(nodeRepo());
  init(root);
  const doc = read(root, 'AGENTS.md').replace('## Gotchas', '## Gotchas\n\nThe seed script is slow.');
  writeFileSync(join(root, 'AGENTS.md'), doc);
  setPkg(root, { ...pkg(root), scripts: { ...pkg(root).scripts, storybook: 'storybook dev' } });
  const r = update(root);
  assert.equal(r.changed, true);
  const after = read(root, 'AGENTS.md');
  assert.match(after, /`pnpm storybook`/);
  assert.match(after, /The seed script is slow\./);
  assert.equal(update(root).changed, false);
});

test('update and init refuse a broken block instead of guessing', () => {
  const root = fixture({ ...nodeRepo(), 'AGENTS.md': '# A\n<!-- repo-onboarding:begin sha=1 -->\nno end\n' });
  assert.throws(() => init(root), /without a matching end marker/);
  assert.throws(() => update(root), /begin marker without an end marker/);
  assert.throws(() => update(fixture(nodeRepo())), /not found/);
});

test('--file CLAUDE.md manages CLAUDE.md alone', () => {
  const root = fixture(nodeRepo());
  init(root, { file: 'CLAUDE.md' });
  assert.equal(existsSync(join(root, 'AGENTS.md')), false);
  assert.ok(findBlock(read(root, 'CLAUDE.md')));
  assert.equal(check(root, { file: 'CLAUDE.md' }).ok, true);
});

test('dry run writes nothing', () => {
  const root = fixture(nodeRepo());
  const r = init(root, { dryRun: true });
  assert.ok(r.files['AGENTS.md']);
  assert.equal(existsSync(join(root, 'AGENTS.md')), false);
});

// ------------------------------------------------------------------ check
test('check: fresh docs pass, placeholders are a warning', () => {
  const root = fixture(nodeRepo());
  init(root);
  const r = check(root);
  assert.equal(r.ok, true);
  assert.deepEqual(codes(r), ['placeholder']);
  assert.equal(check(root, { strict: true }).ok, false);
});

test('check: missing docs', () => {
  const r = check(fixture(nodeRepo()));
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['missing']);
});

test('check: a renamed script makes the block stale and shows the change', () => {
  const root = fixture(nodeRepo());
  init(root);
  const p = pkg(root);
  p.scripts.typecheck = 'tsc --noEmit';
  delete p.scripts.lint;
  setPkg(root, p);
  const r = check(root);
  assert.equal(r.ok, false);
  const stale = r.findings.find((f) => f.code === 'stale');
  assert.ok(stale.detail.includes('- | Lint | `pnpm lint` | package.json |'));
  assert.ok(stale.detail.includes('+ | Type check | `pnpm typecheck` | package.json |'));
});

test('check: hand-written commands and paths are verified', () => {
  const root = fixture(nodeRepo());
  init(root);
  const extra = [
    '',
    '## Notes',
    '',
    'Run `pnpm db:push` then `pnpm db:seed`. `npm run lint && npm run deploy`.',
    'Handlers live in `src/app/api/orders/route.ts` and `src/server/old.ts:12`.',
    'Also see `prisma/schema.prisma`, `owner/repo`, `@scope/pkg`, `v1.2.3`, `.env`.',
    '```bash',
    '$ make build',
    'pnpm --filter web dev',
    '```',
  ].join('\n');
  writeFileSync(join(root, 'AGENTS.md'), read(root, 'AGENTS.md') + extra);
  const r = check(root);
  const cmds = r.findings.find((f) => f.code === 'unknown-command').detail;
  assert.deepEqual(cmds, [
    'AGENTS.md: `pnpm db:seed`: no "db:seed" script in package.json',
    'AGENTS.md: `npm run deploy`: no "deploy" script in package.json',
    'AGENTS.md: `make build`: there is no Makefile',
  ]);
  assert.deepEqual(r.findings.find((f) => f.code === 'missing-path').detail, ['AGENTS.md: `src/server/old.ts`']);
});

test('check: CLAUDE.md that ignores AGENTS.md is an error', () => {
  const root = fixture(nodeRepo());
  init(root, { claude: false });
  write(root, { 'CLAUDE.md': '# Claude\n\nSee `@AGENTS.md` for details.\n' }); // inside backticks: not an import
  const r = check(root);
  assert.ok(codes(r).includes('claude-ignores-agents'));
  write(root, { 'CLAUDE.md': '# Claude\n\nSee @AGENTS.md for details.\n' });
  assert.ok(!codes(check(root)).includes('claude-ignores-agents'));
});

test('check: hand edits inside the block are flagged', () => {
  const root = fixture(nodeRepo());
  init(root);
  const doc = read(root, 'AGENTS.md');
  const blk = findBlock(doc);
  assert.equal(blk.sha, hash(blk.content));
  writeFileSync(join(root, 'AGENTS.md'), doc.replace('Use it; do not mix in another one.', 'Use it.'));
  assert.ok(codes(check(root)).includes('edited'));
});

test('check: long docs get a warning', () => {
  const root = fixture(nodeRepo());
  init(root);
  writeFileSync(join(root, 'AGENTS.md'), read(root, 'AGENTS.md') + '\n- note'.repeat(220));
  assert.ok(codes(check(root)).includes('too-long'));
});

test('references: package-manager builtins, bun runner and fences', () => {
  const r = references([
    '`npm install` `npm ci` `npm test` `npm t` `pnpm add zod` `pnpm dlx x` `yarn` `bun test` `bun build` `bun run dev` `npx prisma generate`',
    '```',
    'yarn lint',
    '```',
  ].join('\n'));
  const texts = r.commands.map((c) => c.text);
  assert.ok(texts.includes('yarn lint'));
  assert.ok(texts.includes('bun run dev'));
  const root = fixture({ 'package.json': { scripts: { test: 'x', dev: 'x', lint: 'x' } } });
  write(root, { 'AGENTS.md': `# A\n\n${r.commands.map((c) => '`' + c.text + '`').join(' ')}\n` });
  assert.equal(check(root).findings.find((f) => f.code === 'unknown-command'), undefined);
});

test('scripts defined in workspace packages count', () => {
  const root = fixture({
    'package.json': { workspaces: ['apps/*'] },
    'apps/web/package.json': { name: 'web', scripts: { storybook: 'x' } },
    'AGENTS.md': '# A\n\nRun `npm run storybook -w apps/web`.\n',
  });
  assert.equal(check(root).findings.find((f) => f.code === 'unknown-command'), undefined);
});

// ------------------------------------------------------------------ hook
test('hook: silent when docs are current or absent, speaks when stale', async () => {
  const root = fixture(nodeRepo());
  assert.equal(await sessionStart(JSON.stringify({ cwd: root }), {}), '');
  init(root);
  assert.equal(await sessionStart(JSON.stringify({ cwd: root }), {}), '');
  setPkg(root, { ...pkg(root), scripts: { dev: 'next dev' } });
  const out = JSON.parse(await sessionStart(JSON.stringify({ cwd: root }), {}));
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /out of date/);
  assert.equal(await sessionStart(JSON.stringify({ cwd: root }), { REPO_ONBOARDING_HOOK: 'off' }), '');
  assert.equal(await sessionStart('not json', { CLAUDE_PROJECT_DIR: root }) !== '', true);
});

test('hook: in repos not managed by repo-onboarding, only the ignored-AGENTS.md problem is raised', async () => {
  const root = fixture({ ...nodeRepo(), 'AGENTS.md': '# A\n\nRun `npm run nope`.\n' });
  assert.equal(await sessionStart(JSON.stringify({ cwd: root }), {}), '');
  write(root, { 'CLAUDE.md': '# C\n' });
  assert.match(await sessionStart(JSON.stringify({ cwd: root }), {}), /does not import AGENTS\.md/);
});

// ------------------------------------------------------------------ CLI
test('cli: exit codes and output', () => {
  const root = fixture(nodeRepo());
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.match(run('--version').stdout, /^\d+\.\d+\.\d+/);
  assert.equal(run('check', root).status, 1);
  assert.equal(run('init', root).status, 0);
  const ok = run('check', root);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /TODO\(onboarding\)/);
  assert.equal(run('check', root, '--strict').status, 1);
  const json = JSON.parse(run('check', root, '--json').stdout);
  assert.equal(json.ok, true);
  assert.equal(run('nope').status, 2);
  assert.equal(run('check', root, '--bogus').status, 2);
  const hook = spawnSync(process.execPath, [CLI, 'hook', 'session-start'], { input: '{"cwd":"/definitely/not/here"}', encoding: 'utf8' });
  assert.equal(hook.status, 0);
  assert.equal(hook.stdout, '');
});

test('cli: scan --json is valid JSON', () => {
  const out = execFileSync(process.execPath, [CLI, 'scan', fixture(nodeRepo()), '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(out).packageManager.name, 'pnpm');
});

test('references: ignore marker and generic agent-config folders', () => {
  const r = references('Never copy into a project\'s `.claude/agents/` folder.\nOld: `src/legacy.ts` <!-- repo-onboarding:ignore -->\nSee `src/real.ts`.\n');
  assert.deepEqual(r.paths, ['src/real.ts']);
});
