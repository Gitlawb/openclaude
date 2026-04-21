# Agent workflow — operational notes

This document expands [AGENTS.md](../AGENTS.md) with longer-form context for **AI-assisted** and **human** contributors. It is not a duplicate of [CONTRIBUTING.md](../CONTRIBUTING.md); use that file for PR process, code style, and community expectations.

## Repository map (high level)

```
├── bin/openclaude              # CLI wrapper for local dev
├── scripts/                    # build.ts, provider tooling, checks
├── src/                        # application source (CLI, services, tools, utils)
├── vscode-extension/openclaude-vscode/   # VS Code companion extension
├── docs/                       # supplementary documentation
├── package.json                # scripts and dependencies
└── AGENTS.md                   # short agent checklist at repo root
```

When you touch **provider or API shims**, start under `src/services/api/` and related tests. When you touch **tools**, look under `src/tools/`. **MCP** entrypoints live under `src/entrypoints/mcp.ts` and tests alongside them.

## Local OpenAI-compatible backends and browser UIs

OpenClaude often uses `OPENAI_BASE_URL` against a local server (for example [Ollama](https://ollama.com) at `http://127.0.0.1:11434/v1`). **Browser-based** clients call the same **`/v1/chat/completions`** contract but use cross-origin `fetch`, so failures differ from the CLI.

- **Symptom:** `curl http://127.0.0.1:11434/v1/models` returns **200**, but the browser shows **"Failed to fetch"** or the Network tab shows **403** on `OPTIONS` or requests with an **`Origin`** header — that is usually **CORS**, not a dead server.
- **Ollama:** set **`OLLAMA_ORIGINS`** to the exact origin(s) of your web UI (comma-separated), or `*` only on trusted dev machines. **Restart** the Ollama service so the variable is applied. Prefer **`http://127.0.0.1:11434/v1`** as the base URL in the browser (avoid `0.0.0.0` in the browser).
- **Sanity check after CORS changes:**

```bash
curl -sS -D- -o /dev/null -H "Origin: https://example.com" "http://127.0.0.1:11434/v1/models" | head -20
```

On **GET/POST** responses you want **2xx** plus **`Access-Control-Allow-Origin`** (matching your UI origin or `*`, depending on policy). For **`OPTIONS`** preflight responses, also expect **`Access-Control-Allow-Methods`** and **`Access-Control-Allow-Headers`** to include what the browser sends (for example `POST`, `Content-Type`, `Authorization`). If the UI sends cookies or `Authorization: Bearer …` with credentials mode, **`Access-Control-Allow-Credentials: true`** must pair with a **specific** origin (not `*`).

- **Gateway products:** when upstream docs refer to gateway dev servers, point the UI at the **gateway base URL** they print so TLS, routing, and CORS match what the client expects.

Operator-oriented references: [Hermes FAQ and troubleshooting](https://hermes-agent.nousresearch.com/docs/reference/faq).

## Git and forks

If you work from a **fork**, add **`upstream`** pointing at `https://github.com/Gitlawb/openclaude.git` and merge or rebase **`upstream/main`** regularly so pull requests stay small and reviewable.

Prefer **linear, well-described commits**; match any commit-message conventions your branch uses.

## Keeping docs in sync

When you add or rename **`package.json`** scripts, update:

- [AGENTS.md](../AGENTS.md) (verification table)
- [README.md](../README.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) if those files mention the same commands

This reduces drift between human-facing and agent-facing instructions.
