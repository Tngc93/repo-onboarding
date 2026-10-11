// Claude Code SessionStart hook: when the agent docs have drifted from the
// repository, tell Claude at the start of the session so it can say so.
// Silent when everything is fine, when there are no docs yet, and on any error:
// a hook must never get in the way of starting a session.
import { check } from './check.mjs';

const WORTH_SAYING = new Set(['stale', 'claude-ignores-agents', 'unknown-command', 'broken-block']);

export async function sessionStart(stdinText, env = process.env) {
  if (env.REPO_ONBOARDING_HOOK === 'off') return '';
  let cwd = env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    const input = stdinText ? JSON.parse(stdinText) : {};
    if (input.cwd) cwd = env.CLAUDE_PROJECT_DIR || input.cwd;
  } catch {
    /* no or invalid input: use the defaults */
  }
  let result;
  try {
    result = check(cwd);
  } catch {
    return '';
  }
  // Repositories that never ran repo-onboarding have no generated block. There
  // we only speak up about the one problem that is certain: Claude ignoring AGENTS.md.
  const managed = !result.findings.some((f) => f.code === 'no-block' || f.code === 'missing');
  const problems = result.findings.filter((f) => (managed ? WORTH_SAYING.has(f.code) : f.code === 'claude-ignores-agents'));
  if (!problems.length) return '';
  const lines = problems.map((p) => `- ${p.message}${p.detail ? `\n  ${p.detail.slice(0, 5).join('\n  ')}` : ''}`);
  const context = [
    `repo-onboarding: the agent guidance in this repository (${result.file}) is out of date.`,
    ...lines,
    'Until it is refreshed, verify commands against the manifests before relying on them.',
    'Mention this to the user once, briefly, and offer to refresh the docs with the repo-onboarding refresh skill.',
  ].join('\n');
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
}
