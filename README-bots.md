# OpenClaude Bot Gateway

Discord + Telegram bot integration for OpenClaude — run persistent AI bots 24/7 with full access to the OpenClaude agent loop (tools, skills, memory, coordinator).

## What It Does

Turns OpenClaude into a **self-hosted AI bot platform** that:

- **Receives messages** from Discord (servers, DMs, mentions) and Telegram (groups, private)
- **Routes them through OpenClaude's full agent loop** — the same brain that powers the CLI
- **Replies intelligently** on the same channel where the message came from
- **Supports all OpenClaude tools** — file ops, bash, web search, code execution, skills, memory
- **Runs 24/7** with auto-reconnect, healthchecks, Docker/PM2/systemd support
- **Manages channels dynamically** — add/remove/configure without restarting

Think of it as: **OpenClaude CLI, but accessible from Telegram and Discord instead of a terminal.**

## How It Works With the Main Agent

```
┌─────────────┐     ┌─────────────┐
│  Telegram    │     │  Discord    │
│  User sends  │     │  User sends │
│  message     │     │  message    │
└──────┬───────┘     └──────┬──────┘
       │                     │
       ▼                     ▼
┌──────────────────────────────────┐
│         Bot Gateway              │
│  ┌─────────────────────────────┐ │
│  │    Telegram Adapter (grammY)│ │
│  │    Discord Adapter (d.js)   │ │
│  └──────────┬──────────────────┘ │
│             │                    │
│  ┌──────────▼──────────────────┐ │
│  │       Message Bus           │ │
│  │  (routes, filters, auth)    │ │
│  └──────────┬──────────────────┘ │
│             │                    │
│  ┌──────────▼──────────────────┐ │
│  │    Channel Manager          │ │
│  │  (permissions, persistence) │ │
│  └──────────┬──────────────────┘ │
└─────────────┼────────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│      OpenClaude Agent Loop       │
│  ┌─────────────────────────────┐ │
│  │    Coordinator / Query      │ │
│  │    Engine                   │ │
│  ├─────────────────────────────┤ │
│  │  Tools: Bash, FileRead,     │ │
│  │  FileEdit, WebSearch, etc.  │ │
│  ├─────────────────────────────┤ │
│  │  Skills, Memory, Tasks,     │ │
│  │  MCP, gRPC services         │ │
│  └─────────────────────────────┘ │
└──────────────────────────────────┘
              │
              ▼
       Response sent back
       to original channel
```

The bot gateway acts as a **thin adapter layer** — it doesn't replace or duplicate any OpenClaude logic. It just:
1. Receives messages from Telegram/Discord
2. Wraps them in the same format the agent loop expects
3. Forwards to the coordinator
4. Sends the response back to the user

All tools, skills, memory, and capabilities available in the CLI are available to bot users.

## File Structure

```
src/
├── bots/
│   ├── index.ts              ← Re-exports everything
│   ├── manager.ts            ← Gateway + 24/7 lifecycle (start24_7, shutdown, heartbeat)
│   ├── channel-manager.ts    ← Channel registry, JSON persistence, Zod validation
│   ├── health.ts             ← /health + /healthz HTTP endpoints
│   ├── gateway-entry.ts      ← Standalone entrypoint for Docker/PM2/systemd
│   ├── base/
│   │   └── adapter.ts        ← Abstract BaseAdapter (reconnect, status, auth)
│   ├── telegram/
│   │   ├── adapter.ts        ← grammY bot (polling + webhook)
│   │   ├── index.ts
│   │   └── types.ts          ← TelegramChatConfig, TelegramGroupPermissions
│   └── discord/
│       ├── adapter.ts        ← discord.js v14 (DMs, mentions, chunking)
│       ├── index.ts
│       └── types.ts          ← DiscordGuildConfig, DiscordChannelPermissions
├── bus/
│   └── index.ts              ← Message routing bus (pub/sub, platform filters)
├── commands/
│   ├── bots-gateway/         ← /bots [start|stop|status|restart]
│   └── bots-channels/        ← /channels [list|add|remove|enable|disable]
docker/
├── Dockerfile                ← Multi-stage Bun build
└── docker-compose.yml        ← 24/7 with restart: always + healthcheck
ecosystem.config.cjs           ← PM2 cluster config
README-bots.md                 ← This file
.env.example                   ← Template for tokens
```

## Setup Guide

### Step 1: Get Bot Tokens

**Telegram:**
1. Open Telegram, search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot`, follow prompts
3. Copy the token (looks like `123456:ABC-DEF...`)

**Discord:**
1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click "New Application", name it, go to "Bot" tab
3. Click "Reset Token", copy it
4. Enable these **Privileged Gateway Intents**:
   - ✅ Message Content Intent
   - ✅ Server Members Intent
   - ✅ Presence Intent (optional)
5. Go to "OAuth2 > URL Generator", select scopes: `bot`, permissions: `Send Messages`, `Read Message History`
6. Open the generated URL to invite the bot to your server

### Step 2: Configure

Create a `.env` file in the openclaude root:

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF-your-telegram-token
DISCORD_BOT_TOKEN=your.discord.bot.token.here
HEALTH_PORT=3000
```

### Step 3: Run

Pick your deployment method:

#### Option A: Via OpenClaude CLI
```bash
openclaude bots start
openclaude bots status
```

#### Option B: Standalone (Bun)
```bash
bun run src/bots/gateway-entry.ts
```

#### Option C: Docker (24/7)
```bash
cd docker
docker compose up -d
```

#### Option D: PM2 (24/7)
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # auto-start on boot
```

#### Option E: systemd (Linux, 24/7)
```bash
sudo nano /etc/systemd/system/openclaude-bots.service
# Paste the service config (see below)
sudo systemctl enable --now openclaude-bots
```

<details>
<summary>systemd service file</summary>

```ini
[Unit]
Description=OpenClaude Bot Gateway
After=network.target

[Service]
Type=simple
User=openclaude
WorkingDirectory=/opt/openclaude
ExecStart=/home/openclaude/.bun/bin/bun run src/bots/gateway-entry.ts
Restart=always
RestartSec=5
Environment=TELEGRAM_BOT_TOKEN=your-token
Environment=DISCORD_BOT_TOKEN=your-token
Environment=HEALTH_PORT=3000

[Install]
WantedBy=multi-user.target
```
</details>

## CLI Commands

These work inside the OpenClaude interactive session (`openclaude`):

| Command | Description |
|---|---|
| `/bots start` | Start the bot gateway |
| `/bots stop` | Stop the gateway |
| `/bots status` | Show adapter statuses, uptime, errors |
| `/bots restart` | Restart the gateway |
| `/channels list` | List all configured channels |
| `/channels add <id> <telegram\|discord>` | Register a channel |
| `/channels remove <id>` | Remove a channel |
| `/channels enable <id>` | Enable a channel |
| `/channels disable <id>` | Disable a channel |
| `/channels status` | Detailed channel info |

## Integration With OpenClaude Agent

### How messages flow to the agent

In `src/bots/manager.ts`, the `onMessage` handler receives all bot messages:

```typescript
gateway.onMessage(async (msg) => {
  // msg.platform  — 'telegram' | 'discord'
  // msg.userId    — user's ID on that platform
  // msg.content   — the message text
  // msg.sessionId — unique session per user
  // msg.metadata  — chatId, guildId, username, etc.

  // Route through OpenClaude's agent loop:
  // const response = await runAgentLoop(msg.content, msg.sessionId);
  // await gateway.sendMessage(msg.platform, msg.userId, response, msg.metadata);
});
```

To wire it into the real agent loop, you'd call into:
- `src/coordinator/coordinatorMode.ts` — for the coordinator agent
- `src/QueryEngine.ts` — for direct query processing
- Or any other entrypoint that runs the agent loop

The bot gateway is designed to be a **drop-in messaging layer** — the agent logic stays exactly where it is.

### Per-channel agent customization

The channel manager supports per-channel config:

```json
{
  "id": "support-chat",
  "platform": "discord",
  "enabled": true,
  "allowFrom": ["user-id-1", "user-id-2"],
  "allowBots": false,
  "permissions": {
    "allowedUsers": [],
    "allowedRoles": ["admin", "moderator"],
    "adminOnly": false,
    "maxMessageLength": 4000
  },
  "metadata": {
    "systemPrompt": "You are a support assistant...",
    "allowedTools": ["bash", "file-read", "web-search"]
  }
}
```

This lets you:
- Restrict who can talk to the bot
- Set different system prompts per channel
- Limit which tools are available per channel
- Make certain channels admin-only

## Health Monitoring

The gateway exposes HTTP endpoints on port 3000 (configurable):

**`GET /health`** — Full JSON status:
```json
{
  "status": "ok",
  "uptime": 360000,
  "uptimeHuman": "4d 4h",
  "adapters": {
    "telegram": {
      "type": "telegram",
      "enabled": true,
      "connected": true,
      "uptime": 360000,
      "reconnectCount": 0
    },
    "discord": {
      "type": "discord",
      "enabled": true,
      "connected": true,
      "uptime": 360000,
      "reconnectCount": 2,
      "lastError": "WebSocket closed (1006)"
    }
  }
}
```

**`GET /healthz`** — Simple `ok`/`degraded` (for Docker/K8s healthchecks)

## 24/7 Features

- **Auto-reconnect** — Exponential backoff with jitter (1s → 2s → 4s → ... up to 60s, max 10 retries)
- **Heartbeat** — Every 30s checks adapter health, triggers reconnect if needed
- **Graceful shutdown** — Handles SIGTERM (Docker stop) and SIGINT (Ctrl+C)
- **Session persistence** — Channel config saved to `~/.openclaude/channels.json`
- **Message chunking** — Discord 2000-char messages auto-split
- **Rate limit aware** — grammY and discord.js handle their own rate limits

## Troubleshooting

| Problem | Solution |
|---|---|
| Bot doesn't respond in Discord | Check that Message Content Intent is enabled |
| Bot doesn't respond in groups | In Telegram groups, the bot needs to be an admin or you need to message it directly first |
| Gateway won't start | Check that tokens are set: `echo $TELEGRAM_BOT_TOKEN` |
| Health endpoint not responding | Check `HEALTH_PORT` isn't in use: `lsof -i :3000` |
| Frequent reconnects | Check your internet connection; the bot will auto-retry |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | One of these | Telegram bot token from @BotFather |
| `DISCORD_BOT_TOKEN` | One of these | Discord bot token |
| `HEALTH_PORT` | No | Health endpoint port (default: `3000`) |
| `LOG_LEVEL` | No | Logging verbosity (default: `info`) |

## Adding New Platforms

Want to add Slack, WhatsApp, Matrix, etc.? It's straightforward:

1. Copy `src/bots/telegram/` → `src/bots/slack/`
2. Implement `SlackAdapter extends BaseAdapter`
3. Register it in `manager.ts` alongside Telegram/Discord
4. Add config to the schema

The `BaseAdapter` class handles reconnect, status, auth, and message emission — you just need to implement `initialize()`, `start()`, `stop()`, and `sendMessage()`.

## Attribution

Core channel architecture adapted from [hustcc/nano-claw](https://github.com/hustcc/nano-claw) (MIT License).
