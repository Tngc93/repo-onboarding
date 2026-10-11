# Changelog

## 0.1.0

First release.

- `repo-onboarding init` writes `AGENTS.md` with a generated block (stack, commands, layout, environment variables, CI) and a `CLAUDE.md` that imports it. Existing files keep every line people wrote.
- `repo-onboarding update` refreshes only the generated block.
- `repo-onboarding check` reports a stale block, commands and paths in the docs that no longer exist, a `CLAUDE.md` that hides `AGENTS.md` from Claude Code, leftover placeholders and docs over 200 lines.
- Scanner support for Node.js (npm, pnpm, yarn, bun, workspaces), Python (uv, Poetry, PDM, Pipenv, pip), Go, Rust, Java/Kotlin (Maven, Gradle), .NET, Ruby, PHP, Deno, Make and just.
- Claude Code plugin with `onboard` and `refresh` skills and a `SessionStart` hook that mentions drift; Codex plugin with the same skills.
- GitHub Action that fails the build when the docs drift.
