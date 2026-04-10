/**
 * BotTool — Agent-callable tool for Discord/Telegram bot management
 *
 * Lets the AI agent check bot status, manage channels, and send messages
 * through connected Telegram/Discord platforms.
 */

import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  DESCRIPTION,
  BOT_TOOL_NAME,
} from './prompt.js'
import {
  renderToolUseMessage,
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseProgressMessage,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum([
        'status',
        'channels list',
        'channels add',
        'channels remove',
        'channels enable',
        'channels disable',
        'send',
      ])
      .describe('The action to perform'),
    platform: z
      .enum(['telegram', 'discord'])
      .optional()
      .describe('Platform for the action (required for send, channels add)'),
    channelId: z
      .string()
      .optional()
      .describe('Channel ID (required for channels add/remove/enable/disable)'),
    userId: z
      .string()
      .optional()
      .describe('User ID to send message to (required for send action)'),
    message: z
      .string()
      .optional()
      .describe('Message content to send (required for send action)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    output: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

// ─── Gateway state (lazy-loaded) ────────────────────────────────────────────

let _gateway: typeof import('../../bots/manager.js') | null = null
let _channelManager: typeof import('../../bots/channel-manager.js') | null = null
let _health: typeof import('../../bots/health.js') | null = null

async function getModules() {
  if (!_gateway) {
    _gateway = await import('../../bots/manager.js')
    _channelManager = await import('../../bots/channel-manager.js')
    _health = await import('../../bots/health.js')
  }
  return {
    BotGateway: _gateway.BotGateway,
    getBotGateway: _gateway.getBotGateway,
    getChannelManager: _channelManager.getChannelManager,
    buildHealthReport: _health.buildHealthReport,
  }
}

// ─── Tool implementation ────────────────────────────────────────────────────

export const BotTool = buildTool({
  name: BOT_TOOL_NAME,
  searchHint: 'manage Discord/Telegram bots, check status, send messages',
  shouldDefer: false,
  async description() {
    return 'Manage the Discord/Telegram bot gateway — check status, manage channels, send messages'
  },
  userFacingName() {
    return 'Bot Manager'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    return getToolUseSummary(input as Record<string, unknown>)
  },
  inputSchema,
  outputSchema,
  renderToolUseMessage(input) {
    return renderToolUseMessage(input as Record<string, unknown>)
  },
  renderToolResultMessage(result) {
    return renderToolResultMessage(result as { success: boolean; output: string })
  },
  renderToolUseProgressMessage() {
    return renderToolUseProgressMessage()
  },
  async *call(input: z.infer<InputSchema>, _context) {
    const { action, platform, channelId, userId, message: msg } = input

    try {
      const result = await handleAction(action, { platform, channelId, userId, message: msg })
      yield {
        type: 'result' as const,
        data: { success: true, output: result },
        resultForAssistant: result,
      }
    } catch (err) {
      const errorStr = err instanceof Error ? err.message : String(err)
      yield {
        type: 'result' as const,
        data: { success: false, output: errorStr },
        resultForAssistant: `Error: ${errorStr}`,
      }
    }
  },
})

// ─── Action handlers ────────────────────────────────────────────────────────

async function handleAction(
  action: string,
  opts: {
    platform?: string
    channelId?: string
    userId?: string
    message?: string
  },
): Promise<string> {
  const { getBotGateway, getChannelManager, buildHealthReport } = await getModules()

  switch (action) {
    case 'status':
      return handleStatus(getBotGateway, buildHealthReport)

    case 'channels list':
      return handleChannelsList(getChannelManager)

    case 'channels add':
      if (!opts.channelId || !opts.platform) {
        throw new Error('channels add requires channelId and platform')
      }
      return handleChannelsAdd(getChannelManager, opts.channelId, opts.platform as 'telegram' | 'discord')

    case 'channels remove':
      if (!opts.channelId) throw new Error('channels remove requires channelId')
      return handleChannelsRemove(getChannelManager, opts.channelId)

    case 'channels enable':
      if (!opts.channelId) throw new Error('channels enable requires channelId')
      return handleChannelsToggle(getChannelManager, opts.channelId, true)

    case 'channels disable':
      if (!opts.channelId) throw new Error('channels disable requires channelId')
      return handleChannelsToggle(getChannelManager, opts.channelId, false)

    case 'send':
      if (!opts.platform || !opts.userId || !opts.message) {
        throw new Error('send requires platform, userId, and message')
      }
      return handleSend(getBotGateway, opts.platform, opts.userId, opts.message, opts.channelId)

    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

function handleStatus(
  getBotGateway: typeof import('../../bots/manager.js').getBotGateway,
  buildHealthReport: typeof import('../../bots/health.js').buildHealthReport,
): string {
  let gateway: ReturnType<typeof getBotGateway>
  try {
    gateway = getBotGateway()
  } catch {
    return '💤 Bot gateway is not running. No adapters configured.'
  }

  const statuses = gateway.getAllStatuses()
  const entries = Object.entries(statuses)

  if (entries.length === 0) {
    return '💤 Bot gateway exists but has no adapters configured.'
  }

  const lines = entries.map(([name, s]) => {
    const icon = s.connected ? '✅' : (s.enabled ? '⚠️' : '⏸️')
    const uptime = formatMs(s.uptime)
    const errs = s.lastError ? `\n     ⚠️  Last error: ${s.lastError}` : ''
    return `${icon} ${name}: ${s.connected ? 'connected' : 'disconnected'} (uptime: ${uptime}, reconnects: ${s.reconnectCount})${errs}`
  })

  return [
    `📊 Bot Gateway Status`,
    ``,
    ...lines,
  ].join('\n')
}

function handleChannelsList(
  getChannelManager: typeof import('../../bots/channel-manager.js').getChannelManager,
): string {
  const cm = getChannelManager()
  const channels = cm.listChannels()

  if (channels.length === 0) {
    return '📋 No channels configured. Use "channels add" to register a channel.'
  }

  const lines = channels.map((c) => {
    const icon = c.enabled ? '🟢' : '🔴'
    const name = c.name ? ` — ${c.name}` : ''
    const perms = c.permissions.adminOnly ? ' (admin only)' : ''
    const users = c.allowFrom.length > 0 ? ` [${c.allowFrom.length} allowed users]` : ''
    return `${icon} ${c.id} (${c.platform})${name}${perms}${users}`
  })

  return `📋 Channels (${channels.length}):\n\n${lines.join('\n')}`
}

function handleChannelsAdd(
  getChannelManager: typeof import('../../bots/channel-manager.js').getChannelManager,
  id: string,
  platform: 'telegram' | 'discord',
): string {
  const cm = getChannelManager()
  cm.addChannel({
    id,
    platform,
    enabled: true,
    allowFrom: [],
    allowBots: false,
    permissions: { allowedUsers: [], allowedRoles: [], adminOnly: false, maxMessageLength: 4000 },
    metadata: {},
  })
  return `✅ Added channel: ${id} (${platform})`
}

function handleChannelsRemove(
  getChannelManager: typeof import('../../bots/channel-manager.js').getChannelManager,
  id: string,
): string {
  const cm = getChannelManager()
  const removed = cm.removeChannel(id)
  return removed ? `🗑️  Removed channel: ${id}` : `Channel not found: ${id}`
}

function handleChannelsToggle(
  getChannelManager: typeof import('../../bots/channel-manager.js').getChannelManager,
  id: string,
  enabled: boolean,
): string {
  const cm = getChannelManager()
  cm.setEnabled(id, enabled)
  return `${enabled ? '✅ Enabled' : '⏸️  Disabled'} channel: ${id}`
}

async function handleSend(
  getBotGateway: typeof import('../../bots/manager.js').getBotGateway,
  platform: string,
  userId: string,
  message: string,
  channelId?: string,
): Promise<string> {
  let gateway: ReturnType<typeof getBotGateway>
  try {
    gateway = getBotGateway()
  } catch {
    throw new Error('Bot gateway is not running. Use `/bots start` first.')
  }
  const metadata = channelId ? { channelId } : undefined
  await gateway.sendMessage(platform, userId, message, metadata)
  return `✅ Sent message to ${userId} via ${platform}${channelId ? ` (channel: ${channelId})` : ''}`
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}
