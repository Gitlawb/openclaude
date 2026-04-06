
# OpenClaude Agent Guide

High-signal guidance for agents working in this repository.

## Critical Developer Commands

- **Build:** `bun run build` (Essential before `dev` or `smoke`).
- **Dev (Fast):** `bun run dev` (Rebuilds and launches the CLI).
- **Test (All):** `bun test`
- **Test (Focused):** 
  - `bun run test:provider` (API/provider logic)
  - `bun run test:provider-recommendation` (Ranking/Discovery)
  - `bun test src/path/to/file.test.ts`
- **Verification:** `bun run smoke` (Quick check if the build even runs).
- **Typecheck:** `bun run typecheck` (`tsc --noEmit`).
- **Full Guardrail:** `bun run hardening:strict` (Lints, typechecks, builds, and runs smoke tests).

## Architecture & Entrypoints

- **Binary Entry:** `bin/openclaude` (Simple wrapper for `dist/cli.mjs`).
- **Source Entry:** `src/entrypoints/cli.tsx` (React-based CLI entry).
- **Build Script:** `scripts/build.ts` (Uses Bun to bundle to `dist/cli.mjs`; handles complex module stubbing for "open" vs "internal" features).
- **Provider Logic:** `src/services/api/` (Contains shims for OpenAI, Gemini, and Codex).

## Repository Structure

- `src/` - core CLI/runtime
  - `src/services/api/` - Provider shims and logic (OpenAI, Gemini, Codex, etc.).
  - `src/entrypoints/` - Application entrypoints (CLI entry).
  - `src/components/`, `src/screens/` - React-based terminal UI elements.
  - `src/utils/` - Shared utilities for git, ripgrep, file system, etc.
  - `src/tools/` - Core tool definitions (bash, read, write, edit, etc.).
- `scripts/` - build, verification, and maintenance scripts
  - `scripts/build.ts` - Main build logic with module stubbing.
  - `scripts/system-check.ts` - Runtime diagnostics (`bun run doctor:runtime`).
  - `scripts/pr-intent-scan.ts` - Security check for pull requests.
- `docs/` - setup, contributor, and project documentation
- `python/` - standalone Python helpers and their tests
- `vscode-extension/openclaude-vscode/` - VS Code extension
- `.github/` - repo automation, templates, and CI configuration
- `bin/` - CLI launcher entrypoints

## Framework Quirks

- **Bun Runtime:** Use `bun` for scripts and testing. Node is used primarily to run the final `dist/cli.mjs`.
- **Module Stubbing:** The build process stubs out many internal Anthropic modules (e.g., `daemon`, `computer-use`). Do not assume these modules are available in the open build.
- **Macros:** `MACRO.VERSION` is forced to `99.0.0` for compatibility; use `MACRO.DISPLAY_VERSION` for the real version.

## Style & Workflow

- **No Telemetry:** Telemetry is intentionally disabled/stripped in the build (`no-telemetry-plugin`).
- **Environment Variables:** Extensive use of `CLAUDE_CODE_USE_OPENAI`, `CLAUDE_CODE_USE_GEMINI`, etc., to toggle backends.
- **Provider Settings:** User settings and agent routing are stored in `~/.claude/settings.json`.
- **Saved Profiles:** Provider-specific configurations are saved in `.openclaude-profile.json`.
- **PR Readiness:** Before submitting, run `bun run build && bun run smoke && bun test`.
- **Security Scans:** Use `bun run security:pr-scan -- --base origin/main` to check for suspicious PR intent.
- **Efficient Reads:** Always use the `limit` parameter with the `read` tool, especially for large files, to maintain performance and context efficiency.

## Testing Quirks

- **Provider Tests:** Many tests require specific environment variables or mocks. `bun run test:provider` is the primary target for API changes.
- **Concurrent Tests:** CI uses `--max-concurrency=1` to avoid flakes in the test runner.
