#!/usr/bin/env node
// repo-onboarding: write and keep true the AGENTS.md / CLAUDE.md that tell AI
// coding agents how a repository works.
import { readFileSync } from 'node:fs';
import { check } from '../src/check.mjs';
import { init, update } from '../src/docs.mjs';
import { sessionStart } from '../src/hook.mjs';
import { renderFacts } from '../src/render.mjs';
import { scan } from '../src/scan.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `repo-onboarding ${VERSION}
Write and keep true the AGENTS.md and CLAUDE.md that tell AI coding agents how a repository works.

Usage
  repo-onboarding scan   [dir] [--json]                 Print what the scanner found
  repo-onboarding init   [dir] [--file F] [--no-claude] [--dry-run]
                                                        Create AGENTS.md (+ CLAUDE.md importing it), or add
                                                        the generated block to an existing file
  repo-onboarding update [dir] [--file F] [--dry-run]   Refresh only the generated block
  repo-onboarding check  [dir] [--file F] [--json] [--strict]
                                                        Report drift; exit 1 on errors (and warnings with --strict)
  repo-onboarding hook session-start                    Claude Code SessionStart hook (reads JSON on stdin)

Options
  --file F      Guidance file to manage (default AGENTS.md)
  --no-claude   Do not create or edit CLAUDE.md
  --dry-run     Show what would change, write nothing
  --json        Machine-readable output
  --strict      Treat warnings as failures

Text you write outside the generated block is never changed.`;

function parse(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-claude') opts.claude = false;
    else if (a === '--file') opts.file = argv[++i];
    else if (a.startsWith('--file=')) opts.file = a.slice(7);
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') opts.version = true;
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else opts._.push(a);
  }
  return opts;
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const LEVEL = { error: paint('31', 'error'), warn: paint('33', 'warn '), info: paint('36', 'info ') };

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const [cmd, ...rest] = opts._;
  if (opts.version) return console.log(VERSION);
  if (opts.help || !cmd || cmd === 'help') return console.log(HELP);
  const dir = rest[0] || '.';

  switch (cmd) {
    case 'scan': {
      const facts = scan(dir);
      console.log(opts.json ? JSON.stringify(facts, null, 2) : renderFacts(facts));
      return 0;
    }
    case 'init': {
      const r = init(dir, opts);
      for (const a of r.actions) console.log(`${opts.dryRun ? '[dry run] ' : ''}${a.path}: ${a.action}`);
      if (opts.dryRun) for (const [p, t] of Object.entries(r.files)) console.log(`\n----- ${p} -----\n${t}`);
      const todo = Object.values(r.files).join('').includes('TODO(onboarding)');
      if (todo && !opts.dryRun) {
        console.log('\nNext: the TODO(onboarding) sections need judgment a scanner does not have.');
        console.log('Ask your agent to run the "onboard" skill, or fill them in yourself.');
      }
      return 0;
    }
    case 'update': {
      const r = update(dir, opts);
      console.log(`${opts.dryRun ? '[dry run] ' : ''}${r.file}: ${r.changed ? 'updated generated block' : 'already up to date'}`);
      return 0;
    }
    case 'check': {
      const r = check(dir, opts);
      if (opts.json) {
        console.log(JSON.stringify(r, null, 2));
      } else if (!r.findings.length) {
        console.log(`${paint('32', 'ok')}    ${r.file} matches the repository.`);
      } else {
        for (const f of r.findings) {
          console.log(`${LEVEL[f.level]} ${f.message}`);
          for (const d of f.detail || []) console.log(`        ${d}`);
        }
      }
      return r.ok ? 0 : 1;
    }
    case 'hook': {
      if (rest[0] !== 'session-start') throw new Error('Usage: repo-onboarding hook session-start');
      const out = await sessionStart(await readStdin());
      if (out) process.stdout.write(out);
      return 0;
    }
    default:
      throw new Error(`Unknown command: ${cmd}. Run repo-onboarding --help.`);
  }
}

main().then(
  (code) => process.exit(code || 0),
  (err) => {
    // The hook must never block a session.
    if (process.argv[2] === 'hook') process.exit(0);
    console.error(`repo-onboarding: ${err.message}`);
    process.exit(2);
  },
);
