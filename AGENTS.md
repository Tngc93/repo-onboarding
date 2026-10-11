# AGENTS.md

Guidance for AI coding agents working in this repository (Codex, Claude Code, Cursor, Copilot and others).

## Project

Onboard AI coding agents to a repository: generate AGENTS.md and CLAUDE.md from what the repo actually contains, and catch when they drift.

<!-- repo-onboarding:begin sha=6ed31100d398 · generated from the repository; edit outside this block, refresh with `repo-onboarding update` -->
## Stack

- **Languages:** JavaScript
- **Runtime:** Node.js >=18.17
- **Package manager:** npm (package.json). Use it; do not mix in another one.
- **License:** MIT

## Commands

| Task | Command | Defined in |
| --- | --- | --- |
| Install dependencies | `npm install` | package.json |
| Test | `npm test` | package.json |
| `check` | `npm run check` | package.json |
| `docs:update` | `npm run docs:update` | package.json |

## Layout

- `.claude-plugin/` Claude Code plugin manifest
- `.codex-plugin/` Codex plugin manifest
- `.github/` GitHub workflows and templates
- `cli/` command-line entry point
- `docs/` documentation
- `hooks/` hooks
- `skills/` agent skills
- `src/` source code
- `test/` tests

Entry points: `cli/repo-onboarding.mjs`

## CI

Run these locally before pushing; CI runs the same checks.

- `.github/workflows/ci.yml` (CI): `npm test`
<!-- repo-onboarding:end -->

## Architecture

A zero-dependency Node.js ESM CLI. Data flows one way: **scan → render → write or compare**.

- `cli/repo-onboarding.mjs` parses arguments and dispatches to `scan`, `init`, `update`, `check` and `hook session-start`. Start here.
- `src/scan.mjs` reads manifests, lockfiles, CI workflows and the file list and returns plain facts. One function per ecosystem (`nodeFacts`, `pythonFacts`, `goFacts`…). It never runs project code.
- `src/files.mjs` lists files with `git ls-files` (respects `.gitignore`) and falls back to a directory walk.
- `src/render.mjs` turns facts into the Markdown of the generated block, plus the `AGENTS.md` and `CLAUDE.md` templates.
- `src/blocks.mjs` finds and replaces the block between `repo-onboarding:begin` and `repo-onboarding:end`, and hashes it.
- `src/docs.mjs` implements `init` and `update`. `src/check.mjs` implements drift detection. `src/hook.mjs` wraps `check` for the Claude Code `SessionStart` hook.
- `skills/onboard` and `skills/refresh` are the agent-facing instructions; `hooks/hooks.json`, `.claude-plugin/` and `.codex-plugin/` package them as plugins; `action.yml` is the GitHub Action.

## Conventions

- No runtime dependencies. Use only Node.js built-ins available in Node 18.17.
- The scanner must be deterministic: sort every list, and keep volatile numbers (file counts, dates) out of rendered output, or every commit would mark the docs stale.
- Never write text outside the generated block, except the single `@AGENTS.md` import line in `CLAUDE.md`.
- Never read or print values from `.env` files. Variable names only.
- A new ecosystem gets its own `xxxFacts(root, files, facts)` function in `src/scan.mjs` and fixtures in `test/scan.test.mjs`.
- Tests build throwaway repositories with `fixture()` from `test/helpers.mjs`. Do not add fixture folders to the repository.
- User-facing messages say what is wrong and the exact command that fixes it.

## Before you finish

- Run `npm test` and `npm run check`. Both must pass; CI runs `check` in strict mode, so placeholders and missing paths fail the build.
- If you changed what the scanner reports, run `npm run docs:update` so this file's generated block stays current.
- Add a `CHANGELOG.md` entry for user-visible changes.

## Gotchas

- The plugin keeps its CLI in `cli/`, not `bin/`: a top-level `bin/` stops claude.ai and Cowork from installing a plugin. <!-- repo-onboarding:ignore -->
- The `SessionStart` hook must stay silent and exit 0 on any error. A hook that fails or prints noise gets in the way of every session.
- Claude Code reads `CLAUDE.md` *instead of* `AGENTS.md` when both exist. That is why `init` adds the import and `check` treats a missing import as an error.
- `${CLAUDE_PLUGIN_ROOT}` is substituted in skill text by Claude Code but not by Codex, so the skills also give a relative path to the CLI.
