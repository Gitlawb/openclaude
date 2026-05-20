# Agent Gateway Control Center

Use the browser-based Control Center when you want a normal cross-platform
form app for setup:

```powershell
scripts\release\control-center.bat
```

On macOS/Linux:

```bash
./scripts/release/control-center.sh
```

Or through the package script:

```bash
bun run control-center
```

It opens `http://127.0.0.1:8799`, saves values into `.env` and
`~/.openclaude/agent-gateway.json`, and can start/test the local Agent API,
Open WebUI, and Docker compose stack. It starts Open WebUI with auth disabled
(`WEBUI_AUTH=False`, isolated data dir) so stale local login state does not
block first-run usage.

Run `/agent-gateway` inside OpenClaude when you prefer the terminal UI. The
terminal UI works on Windows, macOS, Linux, WSL, and Docker because it uses the
same Ink console surface as the main CLI.

## What It Configures

- Model provider profile: provider, base URL, model, and API key.
- Agent API: host, port, CORS, and generated Bearer API key.
- Telegram bridge: bot token, home chat, allowed chat IDs, allowed user IDs,
  file downloads, audio transcription, and API response mirroring.
- Cron scheduler. Release launchers default it on because scheduler jobs are
  part of the agent runtime.
- Ouroboros: consciousness loop, infinite task command, wakeup interval, and
  full-tool-access mode for gateway runs.
- Open WebUI: Python command, data directory, port, install, and serve.
- Runner: working directory, max turns, timeout, and permission mode for API,
  Telegram, cron, and Ouroboros tasks.

Values are saved in `~/.openclaude/agent-gateway.json`. Provider profiles are
saved in OpenClaude global settings and applied to the process environment when
selected. Environment variables can override gateway settings at startup; see
`.env.example`.

## OnlySQ Provider

OnlySQ works as an OpenAI-compatible provider with this base URL:

```bash
CLAUDE_CODE_USE_OPENAI=1
OPENAI_BASE_URL=https://api.onlysq.ru/ai/openai
OPENAI_MODEL=gemini-3-flash
OPENAI_API_KEY=sq-your-key
```

Do not append `/v1` to the OnlySQ base URL. The `/agent-gateway` provider picker
includes an OnlySQ preset with this URL.

## Telegram Access

If `allowedChatIds`, `allowedUserIds`, and `homeChatId` are all empty, the bot
accepts messages from any Telegram chat/user. This matches the full-access agent
default.

Once any chat or user allowlist is configured, messages are accepted only when:

- the chat ID is in `allowedChatIds`;
- the chat ID is `homeChatId`; or
- the sender account ID is in `allowedUserIds`.

Use `/chatid` in Telegram to see the current chat ID. Telegram user IDs can be
added through `/agent-gateway`.

## Open WebUI

The control center can install Open WebUI with:

```bash
python3.11 -m pip install open-webui
```

On Windows, use:

```powershell
py -3.11 -m pip install open-webui
```

Then start it with:

```bash
open-webui serve --host localhost --port 8080
```

Open WebUI runs at `http://localhost:8080` by default. The control center starts
it with `OPENAI_API_BASE_URLS` pointing at the local OpenClaude agent API and
`OPENAI_API_KEYS` set to the generated gateway API key.

## Docker

Use the Docker Compose file for a local two-container setup:

```bash
OPENCLAUDE_AGENT_API_KEY=ocag_change_me docker compose -f docker-compose.agent-gateway.yml up --build
```

It starts:

- `openclaude-agent` on host port `8642`;
- `open-webui` on host port `8080`;
- persistent volumes for OpenClaude config and Open WebUI data.

If those host ports are already used, override only the published host ports:

```bash
OPENCLAUDE_AGENT_API_HOST_PORT=18642 \
OPENCLAUDE_OPEN_WEBUI_HOST_PORT=18080 \
OPENCLAUDE_AGENT_API_KEY=ocag_change_me \
docker compose -f docker-compose.agent-gateway.yml up --build
```

Inside Docker, Open WebUI still talks to `http://openclaude-agent:8642/v1`.

Docker can inherit the local provider/API settings or use a separate provider
profile. In the Control Center Docker section, disable "Reuse local
provider/API" and set Docker provider, base URL, model, and API key when the
container should use another account, model, or OpenAI-compatible endpoint.

For direct compose starts, use Docker-specific provider variables:

```bash
OPENCLAUDE_DOCKER_PROVIDER=openai \
OPENCLAUDE_DOCKER_BASE_URL=https://api.onlysq.ru/ai/openai \
OPENCLAUDE_DOCKER_MODEL=gemini-3-flash \
OPENCLAUDE_DOCKER_API_KEY=sq-your-docker-key \
docker compose -f docker-compose.agent-gateway.yml up --build
```

Docker Telegram is intentionally disabled by default, even when the local
Telegram gateway is enabled. This prevents the local and Docker instances from
polling the same bot token and replying twice. In the Control Center Docker
section, either set a dedicated Docker bot token or explicitly enable
"Reuse local Telegram settings" when you really want both surfaces on the same
bot.

For direct compose starts, use the Docker-specific variables:

```bash
OPENCLAUDE_DOCKER_TELEGRAM_ENABLED=1 \
OPENCLAUDE_DOCKER_TELEGRAM_BOT_TOKEN=123456:docker-bot-token \
OPENCLAUDE_DOCKER_TELEGRAM_HOME_CHAT_ID=123456789 \
docker compose -f docker-compose.agent-gateway.yml up --build
```

To start fixed local worker replicas as well:

```bash
docker compose -f docker-compose.agent-gateway.yml --profile workers up --build
```

Workers expose agent APIs on `8741` and `8742` with Telegram, cron, and
Ouroboros disabled by default. Enable them only with dedicated worker bot
tokens, for example `OPENCLAUDE_WORKER_TELEGRAM_ENABLED=1` plus
`OPENCLAUDE_WORKER_TELEGRAM_BOT_TOKEN`. Compose also passes through cron tick
settings, Ouroboros wakeup/max-round/budget settings, model provider settings,
and WebSearch provider settings (`WEB_SEARCH_PROVIDER`, provider API keys, and
custom `WEB_*` settings). By default the gateway does not block WebSearch; set
`OPENCLAUDE_AGENT_RUNNER_DISALLOWED_TOOLS` only when a container should deny
specific tools.

Docker starts accept either provider-native env (`CLAUDE_CODE_USE_OPENAI=1`,
`OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY`) or UI-style env
(`OPENCLAUDE_PROVIDER`, `OPENCLAUDE_BASE_URL`, `OPENCLAUDE_MODEL`,
`OPENCLAUDE_API_KEY`). One-off replica scripts preserve provider values from
the env file and only let non-empty shell variables override them.

For arbitrary one-off workers, use:

```bash
scripts/release/start-docker-replica.sh 8750 worker-8750-key
```

On Windows:

```bat
scripts\release\start-docker-replica.bat 8750 worker-8750-key
```

Pass a fourth env-file argument for a separate Telegram bot:

```bat
set OPENCLAUDE_REPLICA_TELEGRAM_ENABLED=1
scripts\release\start-docker-replica.bat 8752 worker-8752-key openclaude-agent-bot-8752 .env.bot
```

See `docs/docker-replicas.md` for API checks and stop commands.

## MCP Router

The project includes `.mcp.json` for MCP Router:

```json
{
  "mcpServers": {
    "mcp-router": {
      "type": "http",
      "url": "http://${MCPR_HOST:-127.0.0.1}:${MCPR_PORT:-3282}/mcp",
      "headers": {
        "Authorization": "Bearer ${MCPR_TOKEN}"
      },
      "headersHelper": "node scripts/mcp-router-headers.cjs"
    }
  }
}
```

Set `MCPR_TOKEN` in `.env` or the shell before starting local or Docker
instances. Local runs connect to `127.0.0.1:3282` by default. Docker scripts set
`MCPR_HOST=host.docker.internal` so containers can reach the host MCP Router
app.

The headers helper prefers `.env` for local desktop runs, which avoids stale
machine-level `MCPR_TOKEN` values. In Docker it keeps container env precedence
when `MCPR_HOST=host.docker.internal`.

`scripts/mcp-router-launcher.cjs` remains available as a stdio bridge fallback
for older MCP clients.

For a local source run, use:

```bash
bun run build
OPENCLAUDE_AGENT_API_ENABLED=1 bun run start:agent-gateway
```

Use the interactive CLI (`node dist/cli.mjs`) when you want to open
`/agent-gateway`.

## Camofox Browser

Camofox is integrated as an optional browser MCP server. It runs separately on
`http://localhost:9377`; OpenClaude connects through
`scripts/release/camofox-mcp-bridge.cjs`.

Windows:

```bat
scripts\release\install-camofox.bat
scripts\release\start-camofox.bat
scripts\release\test-camofox.bat
```

macOS/Linux:

```bash
scripts/release/install-camofox.sh
scripts/release/start-camofox.sh
scripts/release/test-camofox.sh
```

In Docker, point the agent at the host browser server:

```bash
CAMOFOX_URL=http://host.docker.internal:9377
```

## Hindsight Memory

Hindsight is integrated as optional durable memory MCP. It runs separately on
`http://localhost:8888` with UI on `http://localhost:9999`; OpenClaude connects
through `scripts/release/hindsight-mcp-bridge.cjs`.

Windows:

```bat
scripts\release\install-hindsight.bat
scripts\release\hindsight-docker-up.bat
scripts\release\test-hindsight.bat
```

macOS/Linux:

```bash
scripts/release/install-hindsight.sh
scripts/release/hindsight-docker-up.sh
scripts/release/test-hindsight.sh
```

Core env:

```bash
HINDSIGHT_URL=http://localhost:8888
HINDSIGHT_BANK_ID=openclaude-agent
HINDSIGHT_MCP_TIMEOUT=60
OPENCLAUDE_DOCKER_HINDSIGHT_URL=http://host.docker.internal:8888
```

The agent prompt teaches the child runner to use OpenRAG for document RAG,
Camofox for browser automation, and Hindsight for durable memory.

For the product-style launcher, use `scripts/release/control-center.bat` on
Windows or `scripts/release/control-center.sh` on macOS/Linux, then press the
buttons in this order:

1. Save settings.
2. Start API.
3. Install Open WebUI if it is not installed yet.
4. Start Open WebUI.
5. Start Docker if you need the containerized instance.
6. Run the local/Docker smoke tests from the same form.
