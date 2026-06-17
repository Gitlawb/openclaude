# AGENTS.md - AI Agent Coding Guide

This guide is for AI coding agents working in the OpenClaude repository. Read it before changing code, and also follow [CONTRIBUTING.md](CONTRIBUTING.md) for contributor policy, PR expectations, review follow-up, and project scope.

## Project Snapshot

OpenClaude is a coding-agent CLI for cloud and local model providers. It supports OpenAI-compatible APIs, Anthropic, Gemini, DeepSeek, Ollama, MCP, local backends, slash commands, tools, agents, and a React/Ink terminal UI.

The installed CLI runs on Node.js `>=22.0.0`. Bun is used for source builds, scripts, dependency management, and tests.

## Work Style

- Keep changes focused on one problem.
- Prefer existing patterns in the file or nearby module.
- Avoid unrelated formatting, renames, dependency changes, or broad rewrites.
- Add or update tests when behavior changes.
- Update docs when setup, commands, provider behavior, or user-facing behavior changes.
- For new features, larger refactors, dependencies, or runtime changes, follow the issue-first guidance in [CONTRIBUTING.md](CONTRIBUTING.md).

## Stack And Conventions

- TypeScript with strict mode and ESM imports.
- React + Ink for terminal UI.
- Bun lockfile and Bun scripts for development workflows.
- Node runtime for the built CLI.
- Python exists for legacy/local-provider helper code. Do not add new Python code or expand Python-based features unless a maintainer explicitly approves that direction.

Common libraries and patterns:

- `chalk` for terminal color.
- `commander` for CLI argument parsing.
- `execa` for child processes.
- Existing service, provider, settings, permission, and UI patterns over new abstractions.

## Repository Map

- `src/commands/` - slash and CLI command implementations.
- `src/components/` - React/Ink UI components.
- `src/services/` - API, MCP, OAuth, wiki, voice, and other service integrations.
- `src/tools/` - tool implementations.
- `src/utils/` - shared utilities.
- `src/integrations/` - provider and model integration metadata.
- `src/entrypoints/` - CLI, MCP, SDK, and generated public types.
- `src/tasks/` - local, remote, workflow, and monitor task handling.
- `docs/integrations/` - provider integration guidance.
- `web/` - documentation website.
- `python/` - legacy/local-provider helper code and tests; maintain existing code here, but prefer TypeScript for new implementation.

## Validation

Run the narrowest useful checks for your change, and list the exact commands in the PR.

Core checks:

```bash
bun install
bun run build
bun run smoke
bun run check
bun run typecheck
bun run typecheck:type-tests
```

Focused checks:

```bash
bun test ./path/to/test-file.test.ts
bun run test:provider
bun run test:provider-recommendation
```

Python checks, only when touching existing Python helper code:

```bash
python -m pytest -q python/tests
```

Web checks, when touching `web/`:

```bash
bun run web:typecheck
bun run web:build
```

Diagnostics and PR hygiene:

```bash
bun run doctor:runtime
bun run security:pr-scan
```

## Provider Changes

When modifying provider behavior:

1. Start with `docs/integrations/overview.md`.
2. Use the relevant how-to guide under `docs/integrations/how-to/`.
3. Check existing provider implementations before adding a new pattern.
4. Test the exact provider/model path you changed when possible.
5. Avoid breaking third-party providers while fixing first-party behavior.

## Things To Avoid

- Do not change the Node runtime or Bun development workflow without prior maintainer agreement.
- Do not add new Python code, Python provider paths, or Python dependencies without explicit maintainer approval.
- Do not introduce dependencies without clear project benefit.
- Do not skip tests for behavior changes.
- Do not silently change provider tags; maintainers control them during review.
- Do not ignore CodeRabbit or maintainer feedback; address it before requesting more review.
