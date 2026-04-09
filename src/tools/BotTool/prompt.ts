/**
 * BotTool — Agent-callable tool for Discord/Telegram bot management
 *
 * Allows the AI agent to:
 * - Check bot gateway status and health
 * - List/manage channels
 * - Send messages through connected platforms
 * - Enable/disable channels
 * - View adapter connection status
 */

export const BOT_TOOL_NAME = 'BotManager'

export const DESCRIPTION = `
- Manages the Discord and Telegram bot gateway
- Use this tool to check bot status, manage channels, and send messages through connected platforms
- The bot gateway runs persistent Discord and Telegram bots that can be accessed 24/7

Use this tool when:
  - The user asks about bot status, health, or connection state
  - The user wants to list, add, remove, enable, or disable channels
  - The user wants to send a message through a specific bot platform
  - The user asks about uptime, reconnects, or errors on connected bots
  - The user wants to start or stop the bot gateway

Actions:
  - "status" — Show gateway status, adapter health, uptime, reconnect counts
  - "channels list" — List all configured channels with their status
  - "channels add" — Register a new channel (requires id and platform)
  - "channels remove" — Remove a channel by ID
  - "channels enable" — Enable a channel
  - "channels disable" — Disable a channel
  - "send" — Send a message through a specific platform to a user/channel

Notes:
  - Bot tokens are configured via environment variables (TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN)
  - Channel configuration is persisted to ~/.openclaude/channels.json
  - Health endpoint is available at /health (configurable port via HEALTH_PORT)
  - This tool is read-only for status checks; send/mutate actions require the gateway to be running
`
