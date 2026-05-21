# OpenClaude Telegram Bot

Remote access to OpenClaude via Telegram. Each Telegram topic maps to an independent query context with conversation history.

## Setup

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
2. Enable topic-based groups in your Telegram group
3. Copy `.env.example` to `.env` and fill in:

```env
BOT_TOKEN=your-bot-token
ALLOWED_USERS=123456789    # Telegram user IDs (comma-separated)
WORK_DIR=/path/to/projects
```

4. Install and run:

```bash
npm install
npm run dev
```

## Commands

| Command | Description |
|---------|-------------|
| `/start`, `/help` | Show help |
| `/new` | Start fresh session in current topic |
| `/kill` | Destroy current session |
| `/sessions` | List active sessions |
| `/cd <path>` | Change working directory |
| `/model <name>` | Switch model |

## Features

- **Topic-based sessions** — Each topic = independent OpenClaude context
- **Conversation history** — Persists across bot restarts (SQLite)
- **Markdown-aware chunking** — Preserves code blocks across message splits
- **File handling** — Upload/download code files through bot
- **Permission control** — Auto-approve or interactive approval via inline keyboard
- **Rate limiting** — 1 msg/sec per topic (Telegram limit)

## Architecture

```
[Telegram Topic] ←→ [Session Manager] ←→ [OpenClude SDK queryAsync()]
       ↑                    ↑
  message_thread_id    SQLite persistence
```

Uses the stable v1 `queryAsync()` API with conversation history replayed on each query.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BOT_TOKEN` | required | Telegram bot token |
| `ALLOWED_USERS` | empty (all) | Comma-separated Telegram user IDs |
| `MAX_SESSIONS` | `10` | Max concurrent sessions |
| `SESSION_TIMEOUT` | `30` | Session timeout (seconds) |
| `WORK_DIR` | `~` | Default working directory |
| `DB_PATH` | `./data/sessions.db` | SQLite database path |
