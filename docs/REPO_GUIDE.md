# OpenClaude Agent Repo Guide

This file is a compact operational map for the agent. It exists so the
gateway can inject a small, durable understanding of its own repository
without bloating `SYSTEM.md` or `ARCHITECTURE.md`.

## What This Repo Is

OpenClaude Agent is a local-first agent runtime with four main surfaces:

1. Interactive CLI / REPL
2. Agent Gateway runtime
3. Telegram provider
4. OpenAI-compatible API for external clients such as Open WebUI

The gateway is the long-lived orchestrator. Each task still runs through a
fresh OpenClaude child process via `agentRunner.ts`.

## Core Runtime Paths

- `src/services/agentGateway/index.ts`
  Gateway bootstrap, lifecycle, restart, runtime registry.
- `src/services/agentGateway/config.ts`
  SSOT for gateway config, defaults, env overrides, state paths.
- `src/services/agentGateway/agentRunner.ts`
  Spawns the child CLI for API, Telegram, cron, and Ouroboros jobs.
- `src/services/agentGateway/apiServer.ts`
  OpenAI-compatible HTTP API.
- `src/services/agentGateway/telegram.ts`
  Telegram bridge, file handling, voice transcription, command handling,
  typing indicator, progress updates.
- `src/services/agentGateway/cron.ts`
  Scheduler with `once`, `interval`, and cron-expression jobs.
- `src/services/agentGateway/consciousness.ts`
  Background consciousness loop.
- `src/services/agentGateway/evolution.ts`
  Evolution cycles and self-review.
- `src/services/agentGateway/memory.ts`
  Identity, scratchpad, dialogue blocks, patterns, and injected repo docs.
- `src/services/agentGateway/selfEdit.ts`
  Safe self-read/self-write/self-edit helpers with BIBLE/identity protections.

## State Layout

The gateway stores state under:

- `~/.openclaude/agent-gateway/` or the active Claude config dir

Important files:

- `agent-gateway.json`
- `cron-jobs.json`
- `logs/chat.jsonl`
- `logs/task_reflections.jsonl`
- `memory/identity.md`
- `memory/scratchpad.md`
- `memory/dialogue_blocks.json`
- `memory/knowledge/patterns.md`

## Scheduler Facts

The scheduler already supports:

- `every 30m`
- `every 10s` if interval parsing is extended to seconds
- `*/15 * * * *` (5-field cron)
- `*/10 * * * * *` (6-field cron with seconds)
- one-shot ISO timestamps like `2030-01-02T03:04:05Z`

Key behavior:

- `deliver: local | telegram | origin`
- outputs are always written to `cron-output/`
- `[SILENT]` suppresses Telegram delivery but still saves output
- optional timezone is respected for cron matching

If cron behavior changes, keep `docs/ARCHITECTURE.md` in sync.

## Telegram Facts

Telegram bridge currently handles:

- text prompts
- progress updates by editing a status message
- `typing...` keepalive via `sendChatAction`
- file download / upload
- voice and audio transcription
- allowlists by chat ID and user ID
- API-response mirroring to the home chat if enabled
- provider switching from Telegram:
  - `/provider` shows the active provider/model/base URL
  - `/provider set <provider> <model> [base_url] [api_key]`
  - `/model <model>`, `/baseurl <url>`, `/apikey <key>`
  - `/provider models` loads OpenAI-compatible model IDs
- error diagnostics:
  - failed agent runs are appended to `logs/telegram-errors.jsonl`
  - `/errors [n]` shows recent failures for the current chat

The bridge is a privileged provider. Its default posture is local-owner use,
not multi-tenant SaaS isolation.

## API Facts

The gateway API is OpenAI-compatible enough for:

- `POST /v1/chat/completions`
- `POST /v1/responses`
- model listing and streaming
- Open WebUI integration

The API does not directly perform filesystem work. The child OpenClaude task
does that through tools.

## Provider Facts

Provider choice should come from saved provider profiles and UI-managed config,
not stale shell env. The UI is responsible for making the chosen provider the
active startup profile.

## Local Worker Replicas

Safe scope for replicas in this repo:

- local Docker containers only
- explicit ports
- explicit API keys
- explicit config volumes
- no uncontrolled self-spreading

Replica purpose:

- context splitting
- specialist workers
- background isolated runs
- API-to-API coordination between local containers

Preferred pattern:

1. main gateway on `8642`
2. worker gateways on dedicated ports such as `8741`, `8742`
3. workers keep Telegram, cron, and Ouroboros off by default
4. main agent coordinates them through HTTP API requests

Current reality:

- this build documents local replica topology, but does not yet automate it
- `fork`, `peers`, and `workflows` commands are currently disabled stubs
- replica orchestration is script-assisted today:
  - `scripts/release/docker-workers-up.*` starts fixed workers on `8741` and `8742`
  - `scripts/release/start-docker-replica.* <port> <api-key>` starts one worker
  - `scripts/release/stop-docker-replica.* <port>` stops one worker
- do not assume uncontrolled self-replication exists

Replica API check:

- `GET http://127.0.0.1:<port>/health`
- `POST http://127.0.0.1:<port>/v1/chat/completions`
- `Authorization: Bearer <api-key>`

## MCP Router

Project `.mcp.json` configures MCP Router as a direct HTTP MCP server:

- URL: `http://${MCPR_HOST:-127.0.0.1}:${MCPR_PORT:-3282}/mcp`
- auth header: `Authorization: Bearer ${MCPR_TOKEN}`
- headers helper: `node scripts/mcp-router-headers.cjs`
- token source: `MCPR_TOKEN` from the shell or local `.env`
- Docker target: `MCPR_HOST=host.docker.internal`, `MCPR_PORT=3282`

Never hard-code the real token in source files. `.env` is gitignored and can
hold local secrets for Docker and local runs.

The headers helper intentionally prefers the local `.env` token for desktop
runs so stale shell-level `MCPR_TOKEN` values do not break the router. In Docker
it keeps container env precedence when `MCPR_HOST=host.docker.internal`.

`scripts/mcp-router-launcher.cjs` is kept as a stdio bridge fallback for MCP
clients that cannot connect to Streamable HTTP MCP servers directly.

## Camofox Browser

Project `.mcp.json` also configures `camofox`, a stdio bridge to the local
`jo-inc/camofox-browser` REST server:

- server URL: `CAMOFOX_URL` or `http://localhost:9377`
- bridge: `node scripts/release/camofox-mcp-bridge.cjs`
- launch scripts: `scripts/release/install-camofox.*`,
  `scripts/release/start-camofox.*`, `scripts/release/test-camofox.*`
- Docker target: `CAMOFOX_URL=http://host.docker.internal:9377`

For real web browsing, browser screenshots, page snapshots, clicking, typing,
and anti-bot pages, prefer `camofox_*` tools when available. Normal flow:
`camofox_create_tab` -> `camofox_snapshot` -> interact by element refs.

See `docs/camofox-integration.md`.

## OpenRAG And Hindsight

Use these as different memory surfaces:

- OpenRAG: document-grounded retrieval and ingestion. Prefer `openrag_search`
  when answering from indexed files, project documents, or an explicit RAG base.
- Hindsight: durable agent/user/project memory. Prefer `hindsight_recall` for
  remembered preferences, prior decisions, recurring failures, and learned
  operating procedures.
- Camofox: live browser work, not memory.

Project `.mcp.json` configures `hindsight`, a stdio bridge to Hindsight:

- server URL: `HINDSIGHT_URL` or `http://localhost:8888`
- bank: `HINDSIGHT_BANK_ID` or `openclaude-agent`
- bridge: `node scripts/release/hindsight-mcp-bridge.cjs`
- launch scripts: `scripts/release/install-hindsight.*`,
  `scripts/release/hindsight-docker-up.*`,
  `scripts/release/hindsight-docker-down.*`, `scripts/release/test-hindsight.*`
- Docker target: `HINDSIGHT_URL=http://host.docker.internal:8888`

Memory operating rule: recall before answering questions about prior memory or
preferences; retain after stable project decisions, recurring fixes, or changes
to how the agent should operate. Never claim a memory read/write happened unless
the `hindsight_*` tool succeeded.

See `docs/openrag-integration.md` and `docs/hindsight-integration.md`.

## Self-Knowledge Rules

When the agent edits itself:

- never delete `BIBLE.md`
- never delete `memory/identity.md`
- update `docs/ARCHITECTURE.md` when structure changes
- keep runtime docs compact
- prefer repo conventions over inventing new layers

## Practical Commands

- Build: `bun run build`
- Tests: `bun test`
- Full typecheck: `bun run typecheck`
- Start gateway: `bun run start:agent-gateway`
- Docker stack: `docker compose -f docker-compose.agent-gateway.yml up --build`

## Current Boundaries

This repo is already a real agent system, but not "done forever".
The hard requirements for calling it stable are:

- repo-wide typecheck green
- build and tests green
- gateway API green
- Telegram provider green
- cron and Ouroboros loops green
- docs in sync with the runtime
