---
name: onboard
description: Onboard AI coding agents to a repository. Creates or improves AGENTS.md and CLAUDE.md from what the code actually contains (commands, layout, architecture, conventions, gotchas) and verifies every command and path. Use when the user asks to onboard a repo, write, generate or improve AGENTS.md or CLAUDE.md, set a repository up for Claude Code or Codex, or when a repository has no agent guidance yet.
---

# Onboard a repository

Goal: an `AGENTS.md` that lets a new agent work in this repository correctly on its first try, plus a `CLAUDE.md` that imports it so Claude Code reads the same guidance. Every line must be true today and must change what an agent does.

The bundled CLI does the mechanical part. Run it with Node 18.17+:

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/repo-onboarding.mjs" <command>
```

If `${CLAUDE_PLUGIN_ROOT}` was not substituted (for example in Codex), the CLI is at `../../cli/repo-onboarding.mjs` relative to this file. Below, `repo-onboarding` means that command.

## 1. Generate the facts

1. `repo-onboarding init --dry-run` shows what will be written. Then run `repo-onboarding init`.
2. This writes a generated block (stack, commands, layout, environment variables, CI) between `repo-onboarding:begin` and `repo-onboarding:end` markers, and `TODO(onboarding)` placeholders for what needs judgment. If `CLAUDE.md` already exists, it only adds an `@AGENTS.md` import line, because Claude Code reads `CLAUDE.md` instead of `AGENTS.md` when both exist.
3. Never edit inside the generated block. `repo-onboarding update` rewrites it.

## 2. Read before you write

Read, in this order, and stop when you have enough:

- `README*` and any existing agent guidance: `CLAUDE.md`, `.cursorrules`, `.cursor/rules/`, `.github/copilot-instructions.md`, `GEMINI.md`. Reuse what is still true.
- The entry points listed in the generated block, then the 3 to 8 files that most of the code depends on.
- The CI workflow, the test setup and one or two existing tests.
- `git log --oneline -30` for commit style and what changes often.

## 3. Fill the TODO(onboarding) sections

Replace each placeholder. If a section has nothing true and useful to say, delete it rather than padding it.

- **Project**: one or two sentences. What it is, who uses it.
- **Architecture**: how a request, job or command flows through the code, naming real files and folders. Point to the files an agent should read first. 4 to 10 bullets.
- **Conventions**: rules a linter does not enforce and that you saw in the code, for example where new endpoints go, how errors are returned, naming, how tests are structured. Write them as instructions. Do not invent rules the code does not follow.
- **Before you finish**: the exact commands a change must pass, and anything else a change must include (tests, migrations, changelog, docs).
- **Gotchas**: generated files that must not be edited, slow or flaky tests, required services, ordering constraints, intentional oddities.

Rules for every line:

- Prefer specific and checkable (`API handlers live in src/app/api/<name>/route.ts`) over general advice (`write clean code`).
- Do not repeat the generated block, the README, or what the code makes obvious.
- No secrets, tokens, internal URLs with credentials, or values from `.env` files. Variable names are fine.
- Keep `AGENTS.md` and `CLAUDE.md` together under about 200 lines. Agents load them every session.
- Write in the language the repository's existing docs use.
- If a fact needs knowledge the code does not contain (team process, deployment approvals, who owns what), ask the user instead of guessing.

## 4. Existing CLAUDE.md

If `CLAUDE.md` already had content, propose moving the tool-agnostic parts (commands, architecture, conventions) into `AGENTS.md` and keeping only Claude Code specifics in `CLAUDE.md`. Show the user what you would move and get a yes before deleting their text from `CLAUDE.md`. Adding the `@AGENTS.md` import does not need approval.

## 5. Verify

1. Run `repo-onboarding check`. Fix every error and every `missing-path` warning in the sections you wrote.
2. If the test or lint command is quick, run it once to confirm the documented command works. Ask first if it is slow, needs services, or touches anything outside the repository.
3. Re-read `AGENTS.md` top to bottom as a new agent would. Remove anything vague.

## 6. Report

Tell the user in a few lines what you added, what you could not determine, and the questions only they can answer. Offer to add the drift check to CI:

```yaml
- uses: Tngc93/repo-onboarding@v0.1.0
```
