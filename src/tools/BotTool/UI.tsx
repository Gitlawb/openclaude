/**
 * BotTool UI — Render tool use messages for the BotManager tool
 */

import type { ToolInputJSONSchema } from '../../Tool.js'

export function renderToolUseMessage(
  input: Record<string, unknown>,
): string {
  const action = (input.action as string) ?? 'status'
  const parts = [`Action: ${action}`]

  if (input.platform) parts.push(`Platform: ${input.platform}`)
  if (input.channelId) parts.push(`Channel: ${input.channelId}`)
  if (input.userId) parts.push(`User: ${input.userId}`)
  if (input.message) parts.push(`Message: ${(input.message as string).slice(0, 100)}`)

  return parts.join(' | ')
}

export function getToolUseSummary(input: Record<string, unknown>): string {
  const action = (input.action as string) ?? 'status'
  switch (action) {
    case 'status':
      return 'Checking bot gateway status'
    case 'channels list':
      return 'Listing bot channels'
    case 'channels add':
      return `Adding channel ${input.channelId ?? '?'} (${input.platform ?? '?'})`
    case 'channels remove':
      return `Removing channel ${input.channelId ?? '?'}`
    case 'channels enable':
      return `Enabling channel ${input.channelId ?? '?'}`
    case 'channels disable':
      return `Disabling channel ${input.channelId ?? '?'}`
    case 'send':
      return `Sending message via ${input.platform ?? '?'}`
    default:
      return `Bot action: ${action}`
  }
}

export function renderToolResultMessage(result: {
  success: boolean
  output: string
}): string {
  if (!result.success) {
    return `❌ Bot tool error: ${result.output}`
  }
  return result.output
}

export function renderToolUseProgressMessage(): string {
  return 'Processing bot command...'
}
