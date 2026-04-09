# OpenClaude Bot Gateway

Discord + Telegram bot integration for OpenClaude — persistent AI bots 24/7.

## What It Does

- Receives messages from Discord/Telegram
- Routes through OpenClaude's full agent loop (tools, skills, memory)
- Replies on the same channel
- Runs 24/7 with auto-reconnect, Docker/PM2/systemd support
- Agent can manage bots via `BotManager` tool

## Quick Start

```bash
cp .env.example .env
# Set TELEGRAM_BOT_TOKEN and/or DISCORD_BOT_TOKEN

bun run bots              # standalone
openclaude bots start     # via CLI
cd docker && docker compose up -d  # Docker
```

## CLI Commands

```
/bots [start|stop|status|restart]
/channels [list|add|remove|enable|disable]
```

## BotTool (Agent-Callable)

The AI agent can use the `BotManager` tool:

| Action | Description |
|---|---|
| `status` | Check gateway health, uptime, reconnects |
| `channels list` | List configured channels |
| `channels add/remove/enable/disable` | Manage channels |
| `send` | Send message through Telegram/Discord |

## File Structure

```
src/bots/
├── base/adapter.ts          # Abstract adapter (reconnect, auth, status)
├── telegram/adapter.ts      # grammY bot (polling + webhook)
├── discord/adapter.ts       # discord.js v14
├── manager.ts               # Gateway lifecycle, heartbeat, health
├── channel-manager.ts       # Zod-validated, JSON-persisted registry
├── health.ts                # /health + /healthz endpoints
├── gateway-entry.ts         # Standalone 24/7 entrypoint
├── bots.test.ts             # 58 tests, 0 failures
src/bus/index.ts             # Message routing bus
src/commands/bots-gateway/   # /bots CLI command
src/commands/bots-channels/  # /channels CLI command
src/tools/BotTool/           # Agent-callable tool
docker/                      # Dockerfile + docker-compose
ecosystem.config.cjs         # PM2 config
```

## Features

- Auto-reconnect (exponential backoff + jitter)
- Health endpoint (`/health` JSON, `/healthz` simple)
- Per-channel permissions (user allowlists, admin-only)
- Discord message chunking (2000-char split)
- Graceful shutdown (SIGTERM/SIGINT)
- Heartbeat (30s interval)
- Runtime channel management (no restart needed)

## New Packages

- `grammy` — Telegram bot framework
- `discord.js` v14 — Discord API client

## Attribution

Adapted from [hustcc/nano-claw](https://github.com/hustcc/nano-claw) (MIT License).
