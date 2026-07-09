/**
 * Resolve autonomy provider override from a message list (main thread or agent).
 * Shared by REPL getToolUseContext and AgentTool/runAgent for consistent routing.
 */

import type { Message } from '../../types/message.js'
import {
  resolveAgentProvider,
  type ProviderOverride,
} from '../api/agentRouting.js'
import { isAutonomyEnabled } from './routePolicy.js'

export function extractUserTextFromMessages(messages: Message[]): string {
  const parts: string[] = []
  for (const message of messages) {
    if (message.type !== 'user') continue
    const content = message.message.content
    if (typeof content === 'string') {
      parts.push(content)
      continue
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && 'text' in block) {
          parts.push(block.text)
        }
      }
    }
  }
  return parts.filter(Boolean).join('\n')
}

export function messagesHaveImage(messages: Message[]): boolean {
  for (const message of messages) {
    if (message.type !== 'user') continue
    const content = message.message.content
    if (Array.isArray(content) && content.some(b => b.type === 'image')) {
      return true
    }
  }
  return false
}

export type ResolveAutonomyForMessagesInput = {
  messages: Message[]
  agentName?: string
  subagentType?: string
  /** When true, write a telemetry line for this select (main-thread only preferred) */
  recordTelemetry?: boolean
}

/**
 * Returns provider override when autonomy resolves a model; otherwise null.
 */
export function resolveAutonomyForMessages(
  input: ResolveAutonomyForMessagesInput,
): ProviderOverride | null {
  // Lazy load settings to keep unit tests free of config/analytics bootstrap
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getInitialSettings } = require('../../utils/settings/settings.js') as typeof import('../../utils/settings/settings.js')
  const settings = getInitialSettings()
  if (!isAutonomyEnabled(settings)) return null

  const userText = extractUserTextFromMessages(input.messages)
  // Prefer last user turn only for classification (avoid cumulative context noise)
  const lastUserOnly = userText.split('\n').slice(-8).join('\n')
  const hasImage = messagesHaveImage(input.messages)

  const override = resolveAgentProvider(
    input.agentName,
    input.subagentType,
    settings,
    {
      userText: lastUserOnly || userText,
      hasImage,
    },
  )

  if (override && input.recordTelemetry !== false) {
    void import('./telemetry.js').then(({ appendTurnTelemetry }) =>
      appendTurnTelemetry({
        event: 'route_select',
        model: override.model,
        baseURL: override.baseURL,
        tier: override.autonomy?.tier,
        source: override.autonomy?.source,
        reason: override.autonomy?.reason,
        agentName: input.agentName,
        subagentType: input.subagentType,
      }),
    )
  }

  return override
}
