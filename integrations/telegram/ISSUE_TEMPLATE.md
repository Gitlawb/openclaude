# GitHub Issue Proposal

## Title
feat: Telegram bot adapter for remote access with topic-based sessions

## Labels
`enhancement`, `remote-access`, `integrations`

## Body

### Problem

OpenClaude lacks remote access capabilities. Claude Code has native `claude.ai/code` for web-based interaction, but OpenClaude users are limited to local terminal usage. Users need to access OpenClaude from mobile devices or remote locations without SSH.

### Proposed Solution

A Telegram bot adapter that maps Telegram topics to independent OpenClaude query contexts, enabling remote coding assistance from any device with Telegram.

#### Architecture

```
[Telegram Topic] ←→ [Session Manager] ←→ [OpenClaude SDK queryAsync()]
       ↑                    ↑
  message_thread_id    SQLite persistence
```

#### Key Features

- **Topic-based session isolation** — Each Telegram topic maps to one independent OpenClaude query context
- **Markdown-aware output chunking** — Respects Telegram's 4096 char limit, preserves code blocks across splits
- **Permission handling** — `canUseTool` callbacks with auto-approve mode for trusted users and interactive inline keyboard for others
- **File send/receive** — Upload code files to bot, receive generated files back
- **Conversation history** — SQLite persistence survives bot restarts, maintains context across messages
- **Rate limiting** — Per-topic 1 msg/sec to respect Telegram limits
- **Graceful shutdown** — SIGTERM handler saves all session state before exit

#### SDK Integration

Uses the stable v1 API (`queryAsync()` from `@gitlawb/openclaude/sdk`) with conversation history passed in each request. Permission via `canUseTool` callback.

#### Scope

- Standalone Node.js service in `packages/telegram-bot/` (or standalone repo)
- Dependencies: `telegraf`, `@gitlawb/openclaude`, `better-sqlite3`, `p-queue`
- Configuration via environment variables

#### Commands

| Command | Description |
|---------|-------------|
| `/start`, `/help` | Show help text |
| `/new` | Start fresh session in current topic |
| `/kill` | Destroy current session |
| `/sessions` | List all active sessions |
| `/cd <path>` | Change working directory (path-validated) |
| `/model <name>` | Switch model for current session |

#### Alternatives Considered

- **WebUI + Cloudflared**: More complex, needs port management, auth, frontend code
- **v2 `unstable_v2_createSession()`**: Unstable API, high breakage risk for integrations
- **Raw Telegram Bot API**: Too much boilerplate, manual session management

#### Questions

1. Would this be accepted as an upstream feature in the main repo, or should it live as a separate package?
2. Should it use the stable v1 `queryAsync()` API or the v2 `unstable_v2_*` surface?
3. Any preference on directory structure (`packages/telegram-bot/` vs standalone)?
