# Docker Replicas

OpenClaude Agent can run local worker replicas as isolated Docker containers.
Each replica exposes the same OpenAI-compatible API as the main gateway.

## Prerequisites

- Docker Desktop or Docker Engine
- Provider env configured in `.env` or shell:
  - `CLAUDE_CODE_USE_OPENAI=1`
  - `OPENAI_BASE_URL=...`
  - `OPENAI_MODEL=...`
  - `OPENAI_API_KEY=...`
- Optional MCP Router token:
  - `MCPR_TOKEN=...`

The project `.mcp.json` configures `mcp-router` as a direct HTTP MCP server and
reads `MCPR_TOKEN` from the environment or local `.env`. Do not commit real
tokens. `scripts/mcp-router-launcher.cjs` remains available as a stdio fallback
for older MCP clients.

`scripts/mcp-router-headers.cjs` supplies the authorization header. Local runs
prefer the `.env` token to avoid stale machine-level `MCPR_TOKEN` values; Docker
runs keep container env precedence when `MCPR_HOST=host.docker.internal`.

Local source runs use `127.0.0.1:3282` by default. Docker runs default
`MCPR_HOST` to `host.docker.internal` and add a host-gateway mapping so
container workers can reach the MCP Router app running on the host.

## Main Stack

Windows:

```bat
scripts\release\docker-up.bat
```

macOS/Linux:

```bash
scripts/release/docker-up.sh
```

This starts:

- main agent API on `http://127.0.0.1:8642/v1`
- Open WebUI on `http://127.0.0.1:8080`

If local ports are already occupied, set host-port overrides before starting:

```bash
OPENCLAUDE_AGENT_API_HOST_PORT=18642 \
OPENCLAUDE_OPEN_WEBUI_HOST_PORT=18080 \
scripts/release/docker-up.sh
```

On Windows PowerShell:

```powershell
$env:OPENCLAUDE_AGENT_API_HOST_PORT = "18642"
$env:OPENCLAUDE_OPEN_WEBUI_HOST_PORT = "18080"
scripts\release\docker-up.bat
```

## Fixed Workers

Windows:

```bat
scripts\release\docker-workers-up.bat
```

macOS/Linux:

```bash
scripts/release/docker-workers-up.sh
```

This starts the main gateway plus worker APIs:

- `http://127.0.0.1:8741/v1`
- `http://127.0.0.1:8742/v1`

Workers keep Telegram, cron, and Ouroboros disabled by default. The main agent
can coordinate them through HTTP API calls.

To intentionally run fixed workers with Telegram, use dedicated worker bot
tokens so long polling does not conflict with the main bot:

```bash
OPENCLAUDE_WORKER_TELEGRAM_ENABLED=1
OPENCLAUDE_WORKER_TELEGRAM_BOT_TOKEN=123456:worker-bot-token
OPENCLAUDE_WORKER_TELEGRAM_HOME_CHAT_ID=123456789
OPENCLAUDE_WORKER_TELEGRAM_ALLOWED_USER_IDS=123456789
docker compose -f docker-compose.agent-gateway.yml --profile workers up --build
```

## One-Off Replica On Any Port

Windows:

```bat
scripts\release\start-docker-replica.bat 8750 worker-8750-key
```

macOS/Linux:

```bash
scripts/release/start-docker-replica.sh 8750 worker-8750-key
```

Fourth argument can point at a separate env file for a new bot:

```bat
set OPENCLAUDE_REPLICA_TELEGRAM_ENABLED=1
scripts\release\start-docker-replica.bat 8752 worker-8752-key openclaude-agent-bot-8752 .env.bot
```

```bash
OPENCLAUDE_REPLICA_TELEGRAM_ENABLED=1 \
  scripts/release/start-docker-replica.sh 8752 worker-8752-key openclaude-agent-bot-8752 .env.bot
```

The `.env.bot` file should contain `TELEGRAM_BOT_TOKEN`,
`OPENCLAUDE_TELEGRAM_HOME_CHAT_ID`, and the allowed user/chat IDs for that bot.
Append `--dry-run` as a fifth argument to verify the resolved settings without
building or starting a container.

Provider variables from the env file are preserved. Shell variables only
override them when they are non-empty, so a blank local shell value will not
accidentally erase `CLAUDE_CODE_USE_OPENAI`, `OPENAI_BASE_URL`, or model values
from `.env`. The Docker entrypoint also accepts generic UI-style variables such
as `OPENCLAUDE_PROVIDER=openai`, `OPENCLAUDE_BASE_URL`, `OPENCLAUDE_MODEL`, and
`OPENCLAUDE_API_KEY`, then maps them to the provider-specific CLI environment.

Optional worker overrides:

- Provider overrides: `CLAUDE_CODE_USE_OPENAI`, `OPENAI_BASE_URL`,
  `OPENAI_MODEL`, `OPENAI_API_KEY`, `CLAUDE_CODE_USE_GEMINI`,
  `GEMINI_MODEL`, `CLAUDE_CODE_USE_MISTRAL`, `MISTRAL_MODEL`, and the
  matching API/base URL variables are passed through when non-empty.
- `OPENCLAUDE_AGENT_RUNNER_CWD=/tmp` for smoke tests without scanning the repo.
- `OPENCLAUDE_AGENT_RUNNER_MAX_TURNS=4`
- `OPENCLAUDE_AGENT_RUNNER_TIMEOUT_MS=180000`
- `OPENCLAUDE_AGENT_RUNNER_DISALLOWED_TOOLS=` by default, which keeps full
  functionality including WebSearch. Set it to a comma/space list only when a
  worker must block specific tools.
- `WEB_SEARCH_PROVIDER=auto` and provider keys such as `TAVILY_API_KEY`,
  `EXA_API_KEY`, `FIRECRAWL_API_KEY`, or custom `WEB_*` settings are passed
  through to containers.
- `OPENCLAUDE_REPLICA_TELEGRAM_ENABLED=1`
- `OPENCLAUDE_REPLICA_TELEGRAM_BOT_TOKEN=123456:replica-bot-token`
- `OPENCLAUDE_REPLICA_TELEGRAM_HOME_CHAT_ID=123456789`
- `OPENCLAUDE_REPLICA_TELEGRAM_ALLOWED_USER_IDS=123456789`
- `OPENCLAUDE_REPLICA_CRON_ENABLED=1`
- `OPENCLAUDE_REPLICA_CRON_TICK_SECONDS=5`
- `OPENCLAUDE_REPLICA_OUROBOROS_ENABLED=1`
- `OPENCLAUDE_REPLICA_CONSCIOUSNESS_ENABLED=1`
- `OPENCLAUDE_REPLICA_INFINITE_TASKS_ENABLED=1`
- `OPENCLAUDE_REPLICA_OUROBOROS_WAKEUP_MIN_SECONDS=300`
- `OPENCLAUDE_REPLICA_OUROBOROS_WAKEUP_MAX_SECONDS=7200`
- `OPENCLAUDE_REPLICA_OUROBOROS_MAX_ROUNDS=3`
- `OPENCLAUDE_REPLICA_OUROBOROS_BUDGET_FRACTION=0.1`
- `MCPR_HOST=host.docker.internal`
- `MCPR_PORT=3282`

Stop it:

```bat
scripts\release\stop-docker-replica.bat 8750
```

```bash
scripts/release/stop-docker-replica.sh 8750
```

## API Check

```bash
curl http://127.0.0.1:8750/health
curl http://127.0.0.1:8750/v1/chat/completions \
  -H "Authorization: Bearer worker-8750-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"openclaude-agent","messages":[{"role":"user","content":"Reply with: replica ok"}]}'
```

## Agent Operating Rule

Use replicas for context splitting and specialist workers. Do not create
unbounded replicas. Pick explicit ports, explicit API keys, and stop containers
when the task is done.
