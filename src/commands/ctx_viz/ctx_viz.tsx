import { feature } from 'bun:bundle'
import chalk from 'chalk'
import figures from 'figures'
import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import {
  getEffectiveContextWindowSize,
  getAutoCompactThreshold,
  isAutoCompactEnabled,
} from '../../services/compact/autoCompact.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import { getContextWindowForModel, getModelMaxOutputTokens } from '../../utils/context.js'
import { formatNumber, formatDuration } from '../../utils/format.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import { getCanonicalName } from '../../utils/model/model.js'
import { getCurrentUsage } from '../../utils/tokens.js'
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

function colorFn(c: 'green' | 'yellow' | 'red' | 'cyan' | 'blue'): (text: string) => string {
  const map: Record<string, (text: string) => string> = {
    green: chalk.green,
    yellow: chalk.yellow,
    red: chalk.red,
    cyan: chalk.cyan,
    blue: chalk.blue,
  }
  return map[c] ?? chalk.white
}

function bar(filled: number, total: number, width: number, c: 'green' | 'yellow' | 'red' | 'cyan' | 'blue'): string {
  const ratio = total > 0 ? Math.min(filled / total, 1) : 0
  const filledW = Math.round(ratio * width)
  const emptyW = width - filledW
  return colorFn(c)('\u2588'.repeat(filledW)) + chalk.gray('\u2591'.repeat(emptyW))
}

function categoryLine(label: string, tokens: number, maxTokens: number, width: number, c: 'green' | 'yellow' | 'red' | 'cyan' | 'blue'): string {
  const pct = maxTokens > 0 ? ((tokens / maxTokens) * 100).toFixed(1) : '0.0'
  const b = bar(tokens, maxTokens, width, c)
  return `  ${chalk.bold(formatNumber(tokens)).padStart(12)}  ${pct.padStart(6)}%  ${b}  ${label}`
}

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  const { messages, options: { mainLoopModel } } = context

  const apiView = toApiView(messages)

  const model = mainLoopModel
  const contextWindow = getContextWindowForModel(model, getSdkBetas())
  const effectiveContext = getEffectiveContextWindowSize(model)
  const autoCompactThreshold = getAutoCompactThreshold(model)
  const maxOutput = getModelMaxOutputTokens(model)
  const canonicalName = getCanonicalName(model)
  const autoCompactEnabled = isAutoCompactEnabled()

  const currentUsage = getCurrentUsage(apiView)
  const turnInput = currentUsage?.input_tokens ?? 0
  const turnOutput = currentUsage?.output_tokens ?? 0
  const turnCacheRead = currentUsage?.cache_read_input_tokens ?? 0
  const turnCacheCreation = currentUsage?.cache_creation_input_tokens ?? 0
  const turnTotal = turnInput + turnOutput + turnCacheRead + turnCacheCreation

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
  const sessionTotalTokens = sessionInput + sessionOutput + sessionCacheRead + sessionCacheCreation

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
  if (turnTotal > 0) {
    lines.push(categoryLine('Input', turnInput, contextWindow, barWidth, 'blue'))
    lines.push(categoryLine('Output', turnOutput, contextWindow, barWidth, 'green'))
    if (turnCacheRead > 0) {
      lines.push(categoryLine('Cache read', turnCacheRead, contextWindow, barWidth, 'cyan'))
    }
    if (turnCacheCreation > 0) {
      lines.push(categoryLine('Cache write', turnCacheCreation, contextWindow, barWidth, 'yellow'))
    }
    lines.push(`  ${'Total:'.padStart(14)}  ${chalk.bold(formatNumber(turnTotal))} tokens`)
    const pctUsed = contextWindow > 0 ? ((turnTotal / contextWindow) * 100).toFixed(1) : '0.0'
    lines.push(`  ${'Window used:'.padStart(14)}  ${chalk.bold(pctUsed)}%`)
  } else {
    lines.push(chalk.dim('  No API responses yet'))
  }
  lines.push('')

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

  if (sessionTotalTokens > 0 || sessionCost > 0) {
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

  lines.push(chalk.dim(`  ${figures.info} Run /context for detailed context breakdown, /cost for pricing, /stats for history`))
  lines.push('')

  const output = lines.join('\n')
  onDone(output)
  return null
}
