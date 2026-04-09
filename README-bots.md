# OpenClaude Bot Gateway

Discord + Telegram bot integration for OpenClaude — run persistent AI bots 24/7.

## Architecture

```
src/
├── bots/
│   ├── index.ts              # Re-exports everything
│   ├── manager.ts            # Gateway + 24/7 lifecycle
│   ├── channel-manager.ts    # Channel registry + persistence
│   ├── health.ts             # /health endpoint
│   ├── gateway-entry.ts      # Standalone entrypoint
│   ├── base/
│   │   └── adapter.ts        # Abstract base adapter
│   ├── telegram/
│   │   ├── adapter.ts        # grammY-based Telegram bot
│   │   ├── index.ts
│   │   └── types.ts
│   └── discord/
│       ├── adapter.ts        # discord.js-based Discord bot
│       ├── index.ts
│       └── types.ts
├── bus/
│   └── index.ts              # Message routing bus
├── commands/
│   ├── bots-gateway/         # /bots command
│   └── bots-channels/        # /channels command
docker/
├── Dockerfile
└── docker-compose.yml
ecosystem.config.cjs           # PM2 config
```

## Quick Start

### 1. Set up bot tokens

```bash
cp .env.example .env
# Edit .env with your tokens
```

**Telegram:** Talk to [@BotFather](https://t.me/BotFather), create a bot, copy the token.

**Discord:** Create an app at [discord.com/developers](https://discord.com/developers/applications), add a bot, copy the token. Enable these intents:
- Message Content
- Server Members
- Guilds

### 2. Run via CLI

```bash
# Start the gateway
openclaude bots start

# Check status
openclaude bots status

# Stop
openclaude bots stop

# Manage channels
openclaude channels list
openclaude channels add my-chat telegram
openclaude channels remove my-chat
```

### 3. Run 24/7 (standalone)

```bash
TELEGRAM_BOT_TOKEN=xxx DISCORD_BOT_TOKEN=yyy bun run src/bots/gateway-entry.ts
```

### 4. Run with Docker

```bash
cd docker
docker compose up -d
```

### 5. Run with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### 6. Run with systemd

```ini
# /etc/systemd/system/openclaude-bots.service
[Unit]
Description=OpenClaude Bot Gateway
After=network.target

[Service]
Type=simple
User=openclaude
WorkingDirectory=/opt/openclaude
ExecStart=/usr/local/bin/bun run src/bots/gateway-entry.ts
Restart=always
RestartSec=5
Environment=TELEGRAM_BOT_TOKEN=xxx
Environment=DISCORD_BOT_TOKEN=yyy

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now openclaude-bots
```

## Health Endpoint

The gateway exposes a health check on port 3000 (configurable via `HEALTH_PORT`):

- `GET /health` — Full JSON status report
- `GET /healthz` — Simple OK/degraded (for Docker/K8s healthchecks)

## Channel Management

Channels are persisted to `~/.openclaude/channels.json` and can be managed at runtime:

```bash
# List all channels
openclaude channels list

# Add a channel
openclaude channels add support-chat discord

# Enable/disable
openclaude channels enable support-chat
openclaude channels disable support-chat

# Remove
openclaude channels remove support-chat
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | One of these | Telegram bot token from @BotFather |
| `DISCORD_BOT_TOKEN` | One of these | Discord bot token |
| `HEALTH_PORT` | No | Health endpoint port (default: 3000) |
| `LOG_LEVEL` | No | Logging level (default: info) |

## Features

- **24/7 Operation** — Auto-reconnect with exponential backoff + jitter
- **Health Monitoring** — HTTP health endpoints for Docker/K8s/PM2
- **Dynamic Channels** — Add/remove channels at runtime without restart
- **Per-Channel Permissions** — User allowlists, admin-only mode
- **Message Chunking** — Discord 2000-char limit handling
- **Graceful Shutdown** — SIGTERM/SIGINT handling
- **Heartbeat** — 30s interval connection health checks
- **Cross-Platform** — Same agent loop serves both Telegram and Discord

## Future Platforms

Easy to add Slack, WhatsApp, etc. by copying the `telegram/` or `discord/` adapter pattern and extending the `BaseAdapter` class.

## Attribution

Core channel architecture adapted from [hustcc/nano-claw](https://github.com/hustcc/nano-claw) (MIT License).
