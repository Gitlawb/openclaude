import { feature } from 'bun:bundle'
import chalk from 'chalk'
import figures from 'figures'
import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { microcompactMessages } from '../../services/compact/microCompact.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
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
import {
  getEffectiveContextWindowSize,
  getAutoCompactThreshold,
  isAutoCompactEnabled,
} from '../../services/compact/autoCompact.js'

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

function themeColorToChalk(themeColor: string): (text: string) => string {
  if (themeColor === 'error') return chalk.red
  if (themeColor === 'warning') return chalk.yellow
  if (themeColor === 'success') return chalk.green
  if (themeColor === 'info' || themeColor === 'subtle') return chalk.cyan
  return chalk.blue
}

function bar(filled: number, total: number, width: number, c: string): string {
  const ratio = total > 0 ? Math.min(filled / total, 1) : 0
  const filledW = Math.round(ratio * width)
  const emptyW = width - filledW
  return themeColorToChalk(c)('\u2588'.repeat(filledW)) + chalk.gray('\u2591'.repeat(emptyW))
}

function categoryLine(label: string, tokens: number, maxTokens: number, width: number, c: string): string {
  const pct = maxTokens > 0 ? ((tokens / maxTokens) * 100).toFixed(1) : '0.0'
  const b = bar(tokens, maxTokens, width, c)
  return `  ${chalk.bold(formatNumber(tokens)).padStart(12)}  ${pct.padStart(6)}%  ${b}  ${label}`
}

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  const {
    messages,
    getAppState,
    options: { mainLoopModel, tools },
  } = context
  const appState = getAppState()

  const apiView = toApiView(messages)
  const { messages: compactedMessages } = await microcompactMessages(apiView)
  const terminalWidth = process.stdout.columns || 80

  const data = await analyzeContextUsage(
    compactedMessages,
    mainLoopModel,
    async () => appState.toolPermissionContext,
    tools,
    appState.agentDefinitions,
    terminalWidth,
    context,
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

  const barWidth = 30
  const lines: string[] = []

  lines.push('')
  lines.push(chalk.bold.cyan(`  ${figures.bullet} Context Window: ${canonicalName}`))
  lines.push('')

  lines.push(chalk.bold('  Window Capacity'))
  lines.push(`    ${figures.bullet} Context window:    ${chalk.bold(formatNumber(contextWindow))} tokens`)
  lines.push(`    ${figures.bullet} Effective context:  ${chalk.bold(formatNumber(effectiveContext))} tokens`)
  lines.push(`    ${figures.bullet} Max output:         ${chalk.bold(formatNumber(maxOutput.default))} tokens${maxOutput.default !== maxOutput.upperLimit ? ` (up to ${formatNumber(maxOutput.upperLimit)})` : ''}`)
  if (autoCompactEnabled) {
    lines.push(`    ${figures.bullet} Auto-compact at:    ${chalk.bold(formatNumber(autoCompactThreshold))} tokens`)
  }
  lines.push('')

  lines.push(chalk.bold('  Current Context (what the model sees)'))
  lines.push(`    Total: ${chalk.bold(formatNumber(data.totalTokens))} / ${formatNumber(contextWindow)} tokens (${chalk.bold(`${data.percentage}%`)} used)`)
  lines.push('')

  for (const cat of data.categories) {
    if (cat.tokens > 0) {
      lines.push(categoryLine(cat.name, cat.tokens, contextWindow, barWidth, cat.color))
    }
  }
  lines.push('')

  if (data.apiUsage) {
    const u = data.apiUsage
    lines.push(chalk.bold('  Last API Response'))
    lines.push(`    ${figures.bullet} Input:       ${chalk.bold(formatNumber(u.input_tokens))} tokens`)
    lines.push(`    ${figures.bullet} Output:      ${chalk.bold(formatNumber(u.output_tokens))} tokens`)
    if (u.cache_read_input_tokens > 0) {
      lines.push(`    ${figures.bullet} Cache read:  ${chalk.bold(formatNumber(u.cache_read_input_tokens))} tokens`)
    }
    if (u.cache_creation_input_tokens > 0) {
      lines.push(`    ${figures.bullet} Cache write: ${chalk.bold(formatNumber(u.cache_creation_input_tokens))} tokens`)
    }
    lines.push('')
  }

  if (Object.keys(modelUsageMap).length > 0) {
    lines.push(chalk.bold('  Per-Model Session Totals'))
    for (const [modelName, usage] of Object.entries(modelUsageMap)) {
      const shortName = getCanonicalName(modelName)
      const parts = [`${formatNumber(usage.inputTokens)} in`, `${formatNumber(usage.outputTokens)} out`]
      if (usage.cacheReadInputTokens > 0) parts.push(`${formatNumber(usage.cacheReadInputTokens)} cache read`)
      if (usage.cacheCreationInputTokens > 0) parts.push(`${formatNumber(usage.cacheCreationInputTokens)} cache write`)
      if (usage.costUSD > 0) parts.push(chalk.yellow(`$${usage.costUSD.toFixed(4)}`))
      lines.push(`    ${chalk.bold(shortName)}: ${parts.join(', ')}`)
    }
    lines.push('')
  }

  if (sessionCost > 0 || sessionInput > 0) {
    lines.push(chalk.bold('  Session Summary'))
    if (sessionCost > 0) {
      lines.push(`    ${figures.bullet} Cost:          ${chalk.bold(chalk.yellow(`$${sessionCost.toFixed(4)}`))}`)
    }
    if (sessionApiDuration > 0) {
      lines.push(`    ${figures.bullet} API duration:  ${chalk.bold(formatDuration(sessionApiDuration))}`)
    }
    if (sessionWallDuration > 0) {
      lines.push(`    ${figures.bullet} Wall duration: ${chalk.bold(formatDuration(sessionWallDuration))}`)
    }
    if (linesAdded > 0 || linesRemoved > 0) {
      lines.push(`    ${figures.bullet} Code changes:  ${chalk.green(`+${linesAdded}`)} / ${chalk.red(`-${linesRemoved}`)} lines`)
    }
    lines.push('')
  }

  lines.push(chalk.dim(`  ${figures.info} Run /context for detailed grid view, /cost for pricing, /stats for history`))
  lines.push('')

  const output = lines.join('\n')
  onDone(output)
  return null
}
