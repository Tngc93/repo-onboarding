---
name: refresh
description: Bring a repository's AGENTS.md and CLAUDE.md back in line with the code after commands, folders, dependencies or CI changed. Use when repo-onboarding reports stale guidance, when `repo-onboarding check` fails, or when the user asks to update, refresh or fix the agent docs.
---

# Refresh agent guidance

The CLI is at `${CLAUDE_PLUGIN_ROOT}/cli/repo-onboarding.mjs` (or `../../cli/repo-onboarding.mjs` relative to this file if the variable was not substituted). Run it with `node`. Below, `repo-onboarding` means that command.

1. Run `repo-onboarding check` and keep its output. It lists:
   - `stale`: the generated block differs from the repository. The `-` and `+` lines show what changed.
   - `unknown-command`: a command written by hand no longer exists.
   - `missing-path`: a file or folder written by hand was not found.
   - `claude-ignores-agents`: `CLAUDE.md` does not import `AGENTS.md`.
2. Run `repo-onboarding update`. This rewrites only the generated block. For `claude-ignores-agents`, run `repo-onboarding init`, which only adds the import line.
3. For each `unknown-command` and `missing-path`, find out what replaced it before editing: look at the manifest scripts, `git log --oneline -20 -- <path>`, `git log -S '<old name>' --oneline`, and search the code. Update the line to the new command or path. Delete it only if the thing is really gone.
4. If the `+` and `-` lines show new top-level folders, a new framework or a changed workflow, check whether the Architecture, Conventions and Gotchas sections are still true, and fix them.
5. Run `repo-onboarding check` again until it reports no errors.
6. Tell the user in two or three lines what changed in the docs. Do not commit unless they ask.
