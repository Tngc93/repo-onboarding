// Turns scan facts into the generated part of AGENTS.md, and builds the
// starter files that hold it. Only deterministic facts go in the generated
// block; anything that needs judgment is left to the agent or the human.

const TASK_ORDER = [
  'Install dependencies', 'Dev server', 'Start', 'Start services', 'Build', 'Test', 'End-to-end tests',
  'Lint', 'Lint and fix', 'Type check', 'Vet', 'Format',
];

function orderCommands(commands) {
  const seen = new Set();
  const rank = (c) => {
    const i = TASK_ORDER.indexOf(c.task);
    return i === -1 ? TASK_ORDER.length : i;
  };
  return commands
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => rank(a) - rank(b) || a.i - b.i)
    .filter((c) => {
      if (seen.has(c.command)) return false;
      seen.add(c.command);
      return true;
    });
}

const code = (s) => '`' + String(s).replace(/`/g, "'") + '`';

export function renderFacts(f) {
  const out = [];
  out.push('## Stack', '');
  if (f.languages.length) out.push(`- **Languages:** ${f.languages.join(', ')}`);
  if (f.runtimes.length) out.push(`- **Runtime:** ${f.runtimes.join(', ')}`);
  if (f.packageManager) out.push(`- **Package manager:** ${f.packageManager.name} (${f.packageManager.evidence}). Use it; do not mix in another one.`);
  if (f.pythonTool) out.push(`- **Python tooling:** ${f.pythonTool.name} (${f.pythonTool.evidence})`);
  if (f.frameworks.length) out.push(`- **Frameworks and tools:** ${f.frameworks.join(', ')}`);
  if (f.workspaces) {
    const pk = f.workspaces.packages.length ? `: ${f.workspaces.packages.map((p) => `${code(p.path)}${p.name !== p.path.split('/').pop() ? ` (${p.name})` : ''}`).join(', ')}` : f.workspaces.globs.length ? `: ${f.workspaces.globs.map(code).join(', ')}` : '';
    out.push(`- **Monorepo:** ${f.workspaces.tool}${pk}`);
  }
  if (f.license) out.push(`- **License:** ${f.license}`);
  if (out.length === 2) out.push('- No build manifest found.');

  const cmds = orderCommands(f.commands);
  if (cmds.length) {
    out.push('', '## Commands', '', '| Task | Command | Defined in |', '| --- | --- | --- |');
    for (const c of cmds.slice(0, 30)) out.push(`| ${c.task} | ${code(c.command)} | ${c.source} |`);
  }

  if (f.layout.length) {
    out.push('', '## Layout', '');
    for (const d of f.layout) {
      out.push(`- ${code(d.path)}${d.note ? ` ${d.note}` : ''}`);
      for (const c of d.children || []) out.push(`  - ${code(c.path)}${c.note ? ` ${c.note}` : ''}`);
    }
  }
  if (f.entryPoints.length) out.push('', `Entry points: ${f.entryPoints.map(code).join(', ')}`);

  if (f.env?.vars.length) {
    const shown = f.env.vars.slice(0, 24).map(code).join(', ');
    const more = f.env.vars.length > 24 ? `, and ${f.env.vars.length - 24} more` : '';
    out.push('', '## Environment', '', `Copy ${code(f.env.file)} to ${code('.env')} and fill it in. Variables: ${shown}${more}.`,
      'Never commit real values or print them in logs.');
  }

  const ci = f.ci.filter((w) => w.runs.length);
  if (ci.length) {
    out.push('', '## CI', '', 'Run these locally before pushing; CI runs the same checks.', '');
    for (const w of ci) out.push(`- ${code(w.file)} (${w.name}): ${w.runs.map(code).join(', ')}`);
  }
  return out.join('\n');
}

export const PLACEHOLDER = 'TODO(onboarding)';

export function agentsTemplate(f, block) {
  const about = f.description ? f.description : `${PLACEHOLDER}: what this project is and who uses it, in one or two sentences.`;
  return `# AGENTS.md

Guidance for AI coding agents working in this repository (Codex, Claude Code, Cursor, Copilot and others).

## Project

${about}

${block}

## Architecture

${PLACEHOLDER}: the main modules and how a request or job moves through them. Name the files an agent should read first.

## Conventions

${PLACEHOLDER}: code style that tools do not enforce, naming, error handling, where new code goes.

## Before you finish

- Run the test and lint commands above and fix what they report.
- ${PLACEHOLDER}: anything else a change must include (tests, docs, changelog, migrations).

## Gotchas

${PLACEHOLDER}: things that look wrong but are intentional, slow or flaky parts, files that are generated and must not be edited.
`;
}

export function claudeTemplate() {
  return `# CLAUDE.md

@AGENTS.md

<!-- Shared guidance for all agents lives in AGENTS.md, imported above.
     Add notes below only if they are specific to Claude Code. -->
`;
}
