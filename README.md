# OpenClaude — Channels & Bot Gateway

> Claude Code opened to any LLM — now with Telegram, Discord, and iMessage channels + a 24/7 bot gateway.

## Overview

OpenClaude combines two messaging systems:

1. **MCP Channel Notifications** — The existing Claude Code channel plugin system, ungated from cloud-dependent restrictions so Telegram, Discord, and iMessage plugins work out of the box.
2. **Bot Gateway** — A standalone 24/7 bot service with native Telegram (grammY) and Discord (discord.js v14) adapters, health endpoints, and agent-callable tools.

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaude                            │
│                                                         │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │  MCP Channels     │    │  Bot Gateway              │   │
│  │  (PR #524)        │    │  (PR #551 + improvements) │   │
│  │                   │    │                            │   │
│  │  telegram plugin  │◄──►│  Telegram Adapter (grammY) │   │
│  │  discord plugin   │◄──►│  Discord Adapter (discord.js)│ │
│  │  imessage plugin  │    │  Message Bus               │   │
│  │                   │    │  Channel Manager            │   │
│  │  Auto-allow       │    │  Health /health + /healthz  │   │
│  │  Queue wakeup     │    │  Rate Limiting              │   │
│  └──────────────────┘    │  Metrics Tracking            │   │
│                          └──────────────────────────┘   │
│                                    │                     │
│                          ┌─────────┴─────────┐          │
│                          │  Bot-to-MCP Bridge │          │
│                          │  (routes between   │          │
│                          │   both systems)    │          │
│                          └───────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Start

### MCP Channel Plugins (recommended for most users)

Channel plugins work immediately after installing OpenClaude — no configuration needed.

```bash
# Install OpenClaude
npm install -g openclaude

# Telegram, Discord, and iMessage channel plugins auto-register
# when they connect via MCP. Just install the plugin:
openclaude plugin install telegram
openclaude plugin install discord

# Or use the --channels flag explicitly:
openclaude --channels plugin:telegram@claude-plugins-official
```

#### What's ungated

- **Feature flags**: `KAIROS`, `KAIROS_CHANNELS`, `KAIROS_PERMISSIONS` → always `true`
- **OAuth requirement**: Removed — API key users can use channels
- **Org policy**: Removed — no Teams/Enterprise `channelsEnabled` needed
- **Allowlist**: Hardcoded to official plugins (`telegram`, `discord`, `imessage`, `fakechat`)
- **Auto-permission**: Channel reply tools auto-allowed (no per-tool prompts)
- **Queue wakeup**: Headless mode auto-runs on channel message arrival

#### Security boundaries (still enforced)

- `--channels` flag required — servers can't self-register without opt-in
- `--dangerously-load-development-channels` required for custom/server-kind entries
- Capability check — server must declare `notifications/claude/channel`
- Marketplace verification — plugin tag must match installed package

---

### Bot Gateway (24/7 deployment)

For running persistent Telegram and Discord bots outside the MCP plugin system.

#### Environment Setup

```bash
# Get tokens:
# Telegram: https://t.me/BotFather → /newbot
# Discord:  https://discord.com/developers/applications → Bot → Token

export TELEGRAM_BOT_TOKEN="your-telegram-bot-token"
export DISCORD_BOT_TOKEN="your-discord-bot-token"
export HEALTH_PORT=3000  # optional, default 3000
```

#### Start via CLI

```bash
# Inside OpenClaude interactive session
/bots start     # Start the gateway
/bots status    # Check adapter health
/bots stop      # Stop the gateway
/bots restart   # Restart all adapters

# Manage channels
/channels list              # List configured channels
/channels add my-telegram telegram  # Add a channel
/channels remove my-telegram        # Remove a channel
/channels enable my-telegram        # Enable a channel
/channels disable my-telegram       # Disable a channel
```

#### Start standalone (Docker/PM2/systemd)

```bash
# Direct execution
TELEGRAM_BOT_TOKEN=xxx DISCORD_BOT_TOKEN=yyy \
  bun run dist/cli.mjs bots gateway

# Or use the entry point
TELEGRAM_BOT_TOKEN=xxx bun run src/bots/gateway-entry.ts
```

#### Docker

```bash
# Build
docker build -f docker/Dockerfile -t openclaude-bots .

# Run
docker run -d --name openclaude-bots \
  -e TELEGRAM_BOT_TOKEN=xxx \
  -e DISCORD_BOT_TOKEN=yyy \
  -v openclaude-data:/home/openclaude/.openclaude \
  -p 3000:3000 \
  openclaude-bots

# Docker Compose
cp .env.example .env  # fill in tokens
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml logs -f
```

#### PM2

```bash
# Install PM2 globally if needed
npm install -g pm2

# Start
pm2 start ecosystem.config.cjs

# Monitor
pm2 logs openclaude-bots
pm2 monit
```

#### systemd

```bash
# Create service file
sudo tee /etc/systemd/system/openclaude-bots.service << 'EOF'
[Unit]
Description=OpenClaude Bot Gateway
After=network.target

[Service]
Type=simple
User=openclaude
WorkingDirectory=/opt/openclaude
ExecStart=/usr/bin/bun run dist/cli.mjs bots gateway
Restart=always
RestartSec=5
Environment=TELEGRAM_BOT_TOKEN=your-token
Environment=DISCORD_BOT_TOKEN=your-token
Environment=HEALTH_PORT=3000

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now openclaude-bots
sudo systemctl status openclaude-bots
```

---

## Architecture

### MCP Channel System (`src/services/mcp/`)

| File | Purpose |
|------|---------|
| `channelAllowlist.ts` | Hardcoded plugin allowlist (replaces GrowthBook) |
| `channelNotification.ts` | Gate logic: capability → runtime → session → allowlist |
| `channelAutoAllow.ts` | Auto-allow rules for channel reply tools |
| `channelPermissions.ts` | Permission relay for channel tools |
| `channelQueueWakeup.ts` | Headless queue auto-run on channel messages |

### Bot Gateway (`src/bots/`)

| File | Purpose |
|------|---------|
| `base/adapter.ts` | Abstract base with reconnect, rate limiting, metrics |
| `telegram/adapter.ts` | Telegram via grammY (polling + webhook) |
| `discord/adapter.ts` | Discord via discord.js v14 (mentions, DMs, chunking) |
| `manager.ts` | 24/7 lifecycle, heartbeat, health server |
| `channel-manager.ts` | Runtime channel registry with JSON persistence |
| `health.ts` | Health report builder with metrics aggregation |
| `bridge.ts` | Bot ↔ MCP channel routing layer |
| `gateway-entry.ts` | Standalone entry point for Docker/PM2 |

### Agent Tool (`src/tools/BotTool/`)

| File | Purpose |
|------|---------|
| `BotTool.ts` | Agent-callable tool for bot management |
| `prompt.ts` | Tool description and action documentation |
| `UI.tsx` | Render tool use messages in the terminal |

### CLI Commands (`src/commands/`)

| Command | Usage |
|---------|-------|
| `/bots [start\|stop\|status\|restart]` | Manage bot gateway lifecycle |
| `/channels [list\|add\|remove\|enable\|disable]` | Manage channel registry |

---

## Health Endpoint

The gateway exposes health checks for monitoring:

```bash
# JSON status (full adapter info + metrics)
curl http://localhost:3000/health
# {
#   "status": "ok",
#   "uptime": 3600000,
#   "uptimeHuman": "1h 0m",
#   "startedAt": "2026-04-10T06:00:00.000Z",
#   "adapters": { ... },
#   "totals": {
#     "messagesReceived": 142,
#     "messagesSent": 89,
#     "errors": 2,
#     "rateLimited": 0,
#     "adapterCount": 2,
#     "connectedCount": 2
#   },
#   "timestamp": "2026-04-10T07:00:00.000Z"
# }

# Simple OK/DEGRADED (for Docker healthcheck / load balancers)
curl http://localhost:3000/healthz
# ok
```

---

## Configuration

### Channel Persistence

Channels are stored in `~/.openclaude/channels.json`:

```json
{
  "version": 1,
  "channels": [
    {
      "id": "my-telegram",
      "platform": "telegram",
      "enabled": true,
      "name": "My Telegram Bot",
      "allowFrom": ["123456789"],
      "allowBots": false,
      "permissions": {
        "allowedUsers": [],
        "allowedRoles": [],
        "adminOnly": false,
        "maxMessageLength": 4000
      },
      "metadata": {},
      "createdAt": "2026-04-10T06:00:00.000Z",
      "updatedAt": "2026-04-10T06:00:00.000Z"
    }
  ]
}
```

### Rate Limiting

Adapters support per-user rate limiting:

```typescript
// In adapter config:
{
  rateLimit: {
    maxMessages: 10,  // max messages per user
    windowMs: 60000   // per 60 seconds
  }
}
```

When rate limited, the adapter logs a warning and increments the `rateLimited` metric.

---

## Testing

```bash
# Run all tests
bun test

# Run specific test files
bun test src/bots/adapter.test.ts
bun test src/bots/health.test.ts
bun test src/bots/channel-manager.test.ts
bun test src/bots/gateway.test.ts
bun test src/bots/bridge.test.ts
bun test src/bus/bus.test.ts
bun test src/tools/BotTool/BotTool.test.ts
bun test src/services/mcp/channelNotification.test.ts
bun test src/services/mcp/channelAutoAllow.test.ts
bun test src/services/mcp/channelQueueWakeup.test.ts
```

---

## What's Better Than the Original PRs

| Improvement | PR #524 | PR #551 | This Version |
|------------|---------|---------|-------------|
| Channel unlocking | ✅ Done | ❌ | ✅ |
| Bot gateway | ❌ | ✅ Done | ✅ + improvements |
| Rate limiting | ❌ | ❌ | ✅ Per-adapter |
| Metrics tracking | ❌ | ❌ | ✅ Messages, errors, rate limited |
| MCP ↔ Bot bridge | ❌ | ❌ | ✅ `BotMcpBridge` |
| Health metrics | ❌ Basic | ❌ Basic | ✅ Full metrics in /health |
| Granular tests | ✅ 3 files | ❌ 1 file | ✅ 7+ files |
| `Bun.sleep` fix | N/A | ❌ Portable | ✅ `setTimeout` |
| Duplicate handler fix | N/A | ❌ | ✅ Wired flag |
| Health EADDRINUSE | N/A | ❌ | ✅ Graceful fallback |
| BotTool error handling | N/A | ❌ | ✅ Gateway not running |
| Discord chunkMessage | N/A | ❌ | ✅ Empty string fix |
| Channel save() errors | N/A | ❌ | ✅ Try/catch |
| Docker healthcheck | N/A | ⚠️ Basic | ✅ Proper label + config |
| PM2 config | N/A | ✅ | ✅ + production tuned |

---

## License

MIT — adapted from [hustcc/nano-claw](https://github.com/hustcc/nano-claw) (MIT License) for bot gateway components.
