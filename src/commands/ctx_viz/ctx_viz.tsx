import chalk from 'chalk'
import figures from 'figures'
import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { formatNumber, formatDuration } from '../../utils/format.js'
import { getCanonicalName } from '../../utils/model/model.js'
import { collectCtxData } from './ctx-noninteractive.js'

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
  const d = await collectCtxData(context)
  const { contextData: data } = d

  const barWidth = 30
  const lines: string[] = []

  lines.push('')
  lines.push(chalk.bold.cyan(`  ${figures.bullet} Context Window: ${d.canonicalName}`))
  lines.push('')

  lines.push(chalk.bold('  Window Capacity'))
  lines.push(`    ${figures.bullet} Context window:    ${chalk.bold(formatNumber(d.contextWindow))} tokens`)
  lines.push(`    ${figures.bullet} Effective context:  ${chalk.bold(formatNumber(d.effectiveContext))} tokens`)
  lines.push(`    ${figures.bullet} Max output:         ${chalk.bold(formatNumber(d.maxOutput.default))} tokens${d.maxOutput.default !== d.maxOutput.upperLimit ? ` (up to ${formatNumber(d.maxOutput.upperLimit)})` : ''}`)
  if (d.autoCompactEnabled) {
    lines.push(`    ${figures.bullet} Auto-compact at:    ${chalk.bold(formatNumber(d.autoCompactThreshold))} tokens`)
  }
  lines.push('')

  lines.push(chalk.bold('  Current Context (what the model sees)'))
  lines.push(`    Total: ${chalk.bold(formatNumber(data.totalTokens))} / ${formatNumber(d.contextWindow)} tokens (${chalk.bold(`${data.percentage}%`)} used)`)
  lines.push('')

  for (const cat of data.categories) {
    if (cat.tokens > 0) {
      lines.push(categoryLine(cat.name, cat.tokens, d.contextWindow, barWidth, cat.color))
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

  const sessionTotalTokens = d.sessionInput + d.sessionOutput + d.sessionCacheRead + d.sessionCacheCreation
  if (sessionTotalTokens > 0) {
    const sessionMax = Math.max(d.sessionInput, d.sessionOutput, d.sessionCacheRead, d.sessionCacheCreation, 1)
    lines.push(chalk.bold('  Session Token Usage'))
    lines.push(categoryLine('Input', d.sessionInput, sessionMax, barWidth, 'blue'))
    lines.push(categoryLine('Output', d.sessionOutput, sessionMax, barWidth, 'green'))
    if (d.sessionCacheRead > 0) {
      lines.push(categoryLine('Cache read', d.sessionCacheRead, sessionMax, barWidth, 'cyan'))
    }
    if (d.sessionCacheCreation > 0) {
      lines.push(categoryLine('Cache write', d.sessionCacheCreation, sessionMax, barWidth, 'yellow'))
    }
    lines.push(`  ${'Total:'.padStart(14)}  ${chalk.bold(formatNumber(sessionTotalTokens))} tokens`)
    lines.push('')
  }

  if (Object.keys(d.modelUsageMap).length > 0) {
    lines.push(chalk.bold('  Per-Model Session Totals'))
    for (const [modelName, usage] of Object.entries(d.modelUsageMap)) {
      const shortName = getCanonicalName(modelName)
      const parts = [`${formatNumber(usage.inputTokens)} in`, `${formatNumber(usage.outputTokens)} out`]
      if (usage.cacheReadInputTokens > 0) parts.push(`${formatNumber(usage.cacheReadInputTokens)} cache read`)
      if (usage.cacheCreationInputTokens > 0) parts.push(`${formatNumber(usage.cacheCreationInputTokens)} cache write`)
      if (usage.costUSD > 0) parts.push(chalk.yellow(`$${usage.costUSD.toFixed(4)}`))
      lines.push(`    ${chalk.bold(shortName)}: ${parts.join(', ')}`)
    }
    lines.push('')
  }

  if (d.sessionCost > 0 || d.sessionInput > 0) {
    lines.push(chalk.bold('  Session Summary'))
    if (d.sessionCost > 0) {
      lines.push(`    ${figures.bullet} Cost:          ${chalk.bold(chalk.yellow(`$${d.sessionCost.toFixed(4)}`))}`)
    }
    if (d.sessionApiDuration > 0) {
      lines.push(`    ${figures.bullet} API duration:  ${chalk.bold(formatDuration(d.sessionApiDuration))}`)
    }
    if (d.sessionWallDuration > 0) {
      lines.push(`    ${figures.bullet} Wall duration: ${chalk.bold(formatDuration(d.sessionWallDuration))}`)
    }
    if (d.linesAdded > 0 || d.linesRemoved > 0) {
      lines.push(`    ${figures.bullet} Code changes:  ${chalk.green(`+${d.linesAdded}`)} / ${chalk.red(`-${d.linesRemoved}`)} lines`)
    }
    lines.push('')
  }

  lines.push(chalk.dim(`  ${figures.info} Run /context for detailed grid view, /cost for pricing, /stats for history`))
  lines.push('')

  const output = lines.join('\n')
  onDone(output)
  return null
}
