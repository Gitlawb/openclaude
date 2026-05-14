import { feature } from 'bun:bundle'
import { getEffectiveContextWindowSize, getAutoCompactThreshold, isAutoCompactEnabled } from '../../services/compact/autoCompact.js'
import { microcompactMessages } from '../../services/compact/microCompact.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Tools } from '../../Tool.js'
import type { AgentDefinitionsResult } from '../../tools/AgentTool/loadAgentsDir.js'
import type { Message } from '../../types/message.js'
import { analyzeContextUsage, type ContextData } from '../../utils/analyzeContext.js'
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

type CtxDataInput = {
  messages: Message[]
  getAppState: () => AppState
  options: {
    mainLoopModel: string
    tools: Tools
    agentDefinitions: AgentDefinitionsResult
    customSystemPrompt?: string
    appendSystemPrompt?: string
  }
}

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

export async function collectCtxData(context: CtxDataInput): Promise<{
  contextData: ContextData
  contextWindow: number
  effectiveContext: number
  autoCompactThreshold: number
  maxOutput: { default: number; upperLimit: number }
  canonicalName: string
  autoCompactEnabled: boolean
  sessionInput: number
  sessionOutput: number
  sessionCacheRead: number
  sessionCacheCreation: number
  sessionCost: number
  sessionApiDuration: number
  sessionWallDuration: number
  linesAdded: number
  linesRemoved: number
  modelUsageMap: ReturnType<typeof getModelUsage>
}> {
  const {
    messages,
    getAppState,
    options: { mainLoopModel, tools, agentDefinitions, customSystemPrompt, appendSystemPrompt },
  } = context

  const apiView = toApiView(messages)
  const { messages: compactedMessages } = await microcompactMessages(apiView)
  const appState = getAppState()

  const contextData = await analyzeContextUsage(
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

  return {
    contextData,
    contextWindow: getContextWindowForModel(model, getSdkBetas()),
    effectiveContext: getEffectiveContextWindowSize(model),
    autoCompactThreshold: getAutoCompactThreshold(model),
    maxOutput: getModelMaxOutputTokens(model),
    canonicalName: getCanonicalName(model),
    autoCompactEnabled: isAutoCompactEnabled(),
    sessionInput: getTotalInputTokens(),
    sessionOutput: getTotalOutputTokens(),
    sessionCacheRead: getTotalCacheReadInputTokens(),
    sessionCacheCreation: getTotalCacheCreationInputTokens(),
    sessionCost: getTotalCostUSD(),
    sessionApiDuration: getTotalAPIDuration(),
    sessionWallDuration: getTotalDuration(),
    linesAdded: getTotalLinesAdded(),
    linesRemoved: getTotalLinesRemoved(),
    modelUsageMap: getModelUsage(),
  }
}

export async function call(
  _args: string,
  context: ToolUseContext,
): Promise<{ type: 'text'; value: string }> {
  const d = await collectCtxData(context)
  const { contextData: data } = d

  const lines: string[] = []

  lines.push(`Context Window: ${d.canonicalName}`)
  lines.push('')
  lines.push(`Window Capacity`)
  lines.push(`  Context window:    ${formatNumber(d.contextWindow)} tokens`)
  lines.push(`  Effective context: ${formatNumber(d.effectiveContext)} tokens`)
  lines.push(`  Max output:        ${formatNumber(d.maxOutput.default)} tokens${d.maxOutput.default !== d.maxOutput.upperLimit ? ` (up to ${formatNumber(d.maxOutput.upperLimit)})` : ''}`)
  if (d.autoCompactEnabled) {
    lines.push(`  Auto-compact at:   ${formatNumber(d.autoCompactThreshold)} tokens`)
  }
  lines.push('')

  lines.push(`Current Context (what the model sees)`)
  lines.push(`  Total: ${formatNumber(data.totalTokens)} / ${formatNumber(d.contextWindow)} tokens (${data.percentage}% used)`)
  for (const cat of data.categories) {
    if (cat.tokens > 0) {
      const pct = d.contextWindow > 0 ? ((cat.tokens / d.contextWindow) * 100).toFixed(1) : '0.0'
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

  const sessionTotalTokens = d.sessionInput + d.sessionOutput + d.sessionCacheRead + d.sessionCacheCreation
  if (sessionTotalTokens > 0) {
    lines.push(`Session Token Usage`)
    lines.push(`  Input:       ${formatNumber(d.sessionInput)} tokens`)
    lines.push(`  Output:      ${formatNumber(d.sessionOutput)} tokens`)
    if (d.sessionCacheRead > 0) lines.push(`  Cache read:  ${formatNumber(d.sessionCacheRead)} tokens`)
    if (d.sessionCacheCreation > 0) lines.push(`  Cache write: ${formatNumber(d.sessionCacheCreation)} tokens`)
    lines.push(`  Total:       ${formatNumber(sessionTotalTokens)} tokens`)
    lines.push('')
  }

  if (Object.keys(d.modelUsageMap).length > 0) {
    lines.push(`Per-Model Session Totals`)
    for (const [modelName, usage] of Object.entries(d.modelUsageMap)) {
      const shortName = getCanonicalName(modelName)
      const parts = [`${formatNumber(usage.inputTokens)} in`, `${formatNumber(usage.outputTokens)} out`]
      if (usage.cacheReadInputTokens > 0) parts.push(`${formatNumber(usage.cacheReadInputTokens)} cache read`)
      if (usage.cacheCreationInputTokens > 0) parts.push(`${formatNumber(usage.cacheCreationInputTokens)} cache write`)
      if (usage.costUSD > 0) parts.push(`$${usage.costUSD.toFixed(4)}`)
      lines.push(`  ${shortName}: ${parts.join(', ')}`)
    }
    lines.push('')
  }

  if (d.sessionCost > 0 || d.sessionInput > 0) {
    lines.push(`Session Summary`)
    if (d.sessionCost > 0) lines.push(`  Cost:          $${d.sessionCost.toFixed(4)}`)
    if (d.sessionApiDuration > 0) lines.push(`  API duration:  ${formatDuration(d.sessionApiDuration)}`)
    if (d.sessionWallDuration > 0) lines.push(`  Wall duration: ${formatDuration(d.sessionWallDuration)}`)
    if (d.linesAdded > 0 || d.linesRemoved > 0) lines.push(`  Code changes:  +${d.linesAdded} / -${d.linesRemoved} lines`)
    lines.push('')
  }

  return { type: 'text' as const, value: lines.join('\n') }
}
