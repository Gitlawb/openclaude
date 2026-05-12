import { feature } from 'bun:bundle'
import { getEffectiveContextWindowSize, getAutoCompactThreshold, isAutoCompactEnabled } from '../../services/compact/autoCompact.js'
import { microcompactMessages } from '../../services/compact/microCompact.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { analyzeContextUsage } from '../../utils/analyzeContext.js'
import { getContextWindowForModel, getModelMaxOutputTokens } from '../../utils/context.js'
import { formatNumber, formatDuration } from '../../utils/format.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import { getCanonicalName } from '../../utils/model/model.js'
import {
  getSdkBetas,
  getModelUsage,
  getTotalInputTokens,
  getTotalOutputTokens,
  getTotalCacheReadInputTokens,
  getTotalCacheCreationInputTokens,
  getTotalCostUSD,
  getTotalAPIDuration,
  getTotalDuration,
  getTotalLinesAdded,
  getTotalLinesRemoved,
} from '../../bootstrap/state.js'

function toApiView(messages: Message[]): Message[] {
  let view = getMessagesAfterCompactBoundary(messages)
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { projectView } = require('../../services/contextCollapse/operations.js') as typeof import('../../services/contextCollapse/operations.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    view = projectView(view)
  }
  return view
}

export async function call(
  _args: string,
  context: ToolUseContext,
): Promise<{ type: 'text'; value: string }> {
  const { messages, getAppState, options } = context
  const { mainLoopModel, tools, agentDefinitions, customSystemPrompt, appendSystemPrompt } = options

  const apiView = toApiView(messages)
  const { messages: compactedMessages } = await microcompactMessages(apiView)
  const appState = getAppState()

  const data = await analyzeContextUsage(
    compactedMessages,
    mainLoopModel,
    async () => appState.toolPermissionContext,
    tools,
    agentDefinitions,
    undefined,
    { options: { customSystemPrompt, appendSystemPrompt } } as Pick<ToolUseContext, 'options'>,
    undefined,
    apiView,
  )

  const model = mainLoopModel
  const contextWindow = getContextWindowForModel(model, getSdkBetas())
  const effectiveContext = getEffectiveContextWindowSize(model)
  const autoCompactThreshold = getAutoCompactThreshold(model)
  const maxOutput = getModelMaxOutputTokens(model)
  const canonicalName = getCanonicalName(model)
  const autoCompactEnabled = isAutoCompactEnabled()

  const sessionInput = getTotalInputTokens()
  const sessionOutput = getTotalOutputTokens()
  const sessionCacheRead = getTotalCacheReadInputTokens()
  const sessionCacheCreation = getTotalCacheCreationInputTokens()
  const sessionCost = getTotalCostUSD()
  const sessionApiDuration = getTotalAPIDuration()
  const sessionWallDuration = getTotalDuration()
  const linesAdded = getTotalLinesAdded()
  const linesRemoved = getTotalLinesRemoved()
  const modelUsageMap = getModelUsage()

  const lines: string[] = []

  lines.push(`Context Window: ${canonicalName}`)
  lines.push('')
  lines.push(`Window Capacity`)
  lines.push(`  Context window:    ${formatNumber(contextWindow)} tokens`)
  lines.push(`  Effective context: ${formatNumber(effectiveContext)} tokens`)
  lines.push(`  Max output:        ${formatNumber(maxOutput.default)} tokens${maxOutput.default !== maxOutput.upperLimit ? ` (up to ${formatNumber(maxOutput.upperLimit)})` : ''}`)
  if (autoCompactEnabled) {
    lines.push(`  Auto-compact at:   ${formatNumber(autoCompactThreshold)} tokens`)
  }
  lines.push('')

  lines.push(`Current Context (what the model sees)`)
  lines.push(`  Total: ${formatNumber(data.totalTokens)} / ${formatNumber(contextWindow)} tokens (${data.percentage}% used)`)
  for (const cat of data.categories) {
    if (cat.tokens > 0) {
      const pct = contextWindow > 0 ? ((cat.tokens / contextWindow) * 100).toFixed(1) : '0.0'
      lines.push(`  ${formatNumber(cat.tokens).padStart(12)}  ${pct.padStart(6)}%  ${cat.name}`)
    }
  }
  lines.push('')

  if (data.apiUsage) {
    const u = data.apiUsage
    lines.push(`Last API Response`)
    lines.push(`  Input:       ${formatNumber(u.input_tokens)} tokens`)
    lines.push(`  Output:      ${formatNumber(u.output_tokens)} tokens`)
    if (u.cache_read_input_tokens > 0) lines.push(`  Cache read:  ${formatNumber(u.cache_read_input_tokens)} tokens`)
    if (u.cache_creation_input_tokens > 0) lines.push(`  Cache write: ${formatNumber(u.cache_creation_input_tokens)} tokens`)
    lines.push('')
  }

  const sessionTotalTokens = sessionInput + sessionOutput + sessionCacheRead + sessionCacheCreation
  if (sessionTotalTokens > 0) {
    lines.push(`Session Token Usage`)
    lines.push(`  Input:       ${formatNumber(sessionInput)} tokens`)
    lines.push(`  Output:      ${formatNumber(sessionOutput)} tokens`)
    if (sessionCacheRead > 0) lines.push(`  Cache read:  ${formatNumber(sessionCacheRead)} tokens`)
    if (sessionCacheCreation > 0) lines.push(`  Cache write: ${formatNumber(sessionCacheCreation)} tokens`)
    lines.push(`  Total:       ${formatNumber(sessionTotalTokens)} tokens`)
    lines.push('')
  }

  if (Object.keys(modelUsageMap).length > 0) {
    lines.push(`Per-Model Session Totals`)
    for (const [modelName, usage] of Object.entries(modelUsageMap)) {
      const shortName = getCanonicalName(modelName)
      const parts = [`${formatNumber(usage.inputTokens)} in`, `${formatNumber(usage.outputTokens)} out`]
      if (usage.cacheReadInputTokens > 0) parts.push(`${formatNumber(usage.cacheReadInputTokens)} cache read`)
      if (usage.cacheCreationInputTokens > 0) parts.push(`${formatNumber(usage.cacheCreationInputTokens)} cache write`)
      if (usage.costUSD > 0) parts.push(`$${usage.costUSD.toFixed(4)}`)
      lines.push(`  ${shortName}: ${parts.join(', ')}`)
    }
    lines.push('')
  }

  if (sessionCost > 0 || sessionInput > 0) {
    lines.push(`Session Summary`)
    if (sessionCost > 0) lines.push(`  Cost:          $${sessionCost.toFixed(4)}`)
    if (sessionApiDuration > 0) lines.push(`  API duration:  ${formatDuration(sessionApiDuration)}`)
    if (sessionWallDuration > 0) lines.push(`  Wall duration: ${formatDuration(sessionWallDuration)}`)
    if (linesAdded > 0 || linesRemoved > 0) lines.push(`  Code changes:  +${linesAdded} / -${linesRemoved} lines`)
    lines.push('')
  }

  return { type: 'text' as const, value: lines.join('\n') }
}
