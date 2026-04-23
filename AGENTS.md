# OpenClaude — guide for AI-assisted editing

This repository is edited by humans **and** by automated agents (IDE assistants, bots, and similar). This file gives agents a **short**, tool-agnostic checklist so changes stay reviewable and verifiable.

## Relationship to other docs

- **Contributor norms, PR expectations, and style** — see [CONTRIBUTING.md](CONTRIBUTING.md). That document is authoritative for humans; follow it first.
- **Install, build, and day-to-day commands** — see [README.md](README.md) (Source Build and Testing sections).
- **Longer operational notes** (repo layout, local gateways, browser CORS, fork hygiene) — see [docs/agent-workflow.md](docs/agent-workflow.md).

If anything here disagrees with `CONTRIBUTING.md` or `README.md`, **trust those files** and propose an update to this guide in the same PR.

## What you are changing

OpenClaude is a **terminal-first coding-agent CLI** (TypeScript, Bun) that talks to many model providers (OpenAI-compatible APIs, Gemini, Codex, Ollama, and others), with tools, MCP, slash commands, and streaming.

- **Upstream:** `https://github.com/Gitlawb/openclaude`
- **Package name:** `@gitlawb/openclaude`

## Workflow (agents)

1. **Read before you edit** — open callers, types, and existing tests; match naming, imports, and patterns in the tree.
2. **Smallest useful diff** — no unrelated refactors, formatting-only sweeps, or new abstractions unless the task requires them.
3. **Verify** — run the narrowest command below that matches your change; report pass/fail with relevant output. Do not claim green without running something appropriate.
4. **Secrets** — never commit API keys or paste them into issues or PRs. Use environment variables and local config only.
5. **Session context** — interpret the latest request in light of earlier messages unless the user clearly changes scope.

## Commands (verification)

Pick the **narrowest** check that covers your change. When in doubt, at least `bun run smoke`.

| Goal | Command |
|------|---------|
| Full build + quick sanity | `bun run smoke` |
| TypeScript only | `bun run typecheck` |
| Default unit suite | `bun test` |
| Provider-focused tests | `bun run test:provider` |
| Provider recommendation tests | `bun run test:provider-recommendation` |
| Stricter gate (typecheck + smoke + runtime doctor) | `bun run hardening:strict` |
| Runtime / profile diagnostics | `bun run doctor:runtime` |
| Deploy from checkout (pack / link / global / registry) | `docs/deploy.md`; `bun run deploy:*` |

CI runs **PR Checks** on GitHub; align with those workflows when you touch packaging, entrypoints, or core paths.

## Environment notes

- Use **Bun** for scripts and tests (`bun install`, then commands above).
- After pulling `main`, run **`bun run build`** or **`bun run smoke`** if `dist/` might be stale.
- Some environments use a minimal `PATH` and may not see `bun`; fix the shell or prepend the directory that contains the `bun` binary before reporting “command not found”.
- **VS Code / Cursor tasks** use **`scripts/cursor-dev-path.sh`** to prepend common Bun paths before running smoke, tests, or deploy helpers (see `.vscode/tasks.json`).

## Editor-specific configuration

This repository **does not** ship editor-only trees (for example `.cursor/` or team-local MCP pins) on `main`. Keep personal or team agent configuration **outside** the repo or in your fork only, so the upstream tree stays neutral for all contributors.

## Further reading

- [docs/agent-workflow.md](docs/agent-workflow.md) — repository map, local OpenAI-compatible servers, browser CORS, fork sync.
- [docs/deploy.md](docs/deploy.md) — install from npm, tarball, `npm link`, global from checkout, upstream release, fork-scoped npm.
- [Hermes agent `AGENTS.md`](https://github.com/NousResearch/hermes-agent/blob/main/AGENTS.md) — example of a deeper, project-wide agent guide (structure reference only).
