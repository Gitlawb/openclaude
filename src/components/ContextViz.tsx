import chalk from 'chalk'
import figures from 'figures'
import React, { useMemo } from 'react'
import type { CommandResultDisplay } from '../commands.js'
import { Box, Text } from '../ink.js'
import {
  getEffectiveContextWindowSize,
  getAutoCompactThreshold,
  isAutoCompactEnabled,
} from '../services/compact/autoCompact.js'
import { getContextWindowForModel, getModelMaxOutputTokens } from '../utils/context.js'
import { formatNumber, formatDuration } from '../utils/format.js'
import { getCanonicalName, getMainLoopModel } from '../utils/model/model.js'
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
} from '../bootstrap/state.js'

type Props = {
  onClose: (result?: string, options?: { display?: CommandResultDisplay }) => void
}

const CHALK_COLORS: Record<string, typeof chalk> = {
  green: chalk.green,
  yellow: chalk.yellow,
  red: chalk.red,
  cyan: chalk.cyan,
  blue: chalk.blue,
}

function ProgressBar({
  filled,
  total,
  width,
  color,
}: {
  filled: number
  total: number
  width: number
  color: 'green' | 'yellow' | 'red' | 'cyan' | 'blue'
}) {
  const ratio = total > 0 ? Math.min(filled / total, 1) : 0
  const filledWidth = Math.round(ratio * width)
  const emptyWidth = width - filledWidth
  const colorFn = CHALK_COLORS[color] ?? chalk.white
  const filledBar = colorFn('\u2588'.repeat(filledWidth))
  const emptyBar = chalk.gray('\u2591'.repeat(emptyWidth))
  return `${filledBar}${emptyBar}`
}

function CategoryRow({
  label,
  tokens,
  total,
  barWidth,
  color,
}: {
  label: string
  tokens: number
  total: number
  barWidth: number
  color: 'green' | 'yellow' | 'red' | 'cyan' | 'blue'
}) {
  const pct = total > 0 ? ((tokens / total) * 100).toFixed(1) : '0.0'
  const bar = ProgressBar({ filled: tokens, total, width: barWidth, color })
  return (
    <Box flexDirection="row">
      <Text>
        {chalk.bold(formatNumber(tokens)).padStart(12)}{' '}
        {chalk.dim(`(${pct}%)`).padStart(10)} {bar} {label}
      </Text>
    </Box>
  )
}

export function ContextViz({ onClose }: Props) {
  const model = getMainLoopModel()
  const data = useMemo(() => {
    const contextWindow = getContextWindowForModel(model, getSdkBetas())
    const effectiveContext = getEffectiveContextWindowSize(model)
    const autoCompactThreshold = getAutoCompactThreshold(model)
    const maxOutput = getModelMaxOutputTokens(model)
    const canonicalName = getCanonicalName(model)
    const autoCompactEnabled = isAutoCompactEnabled()

    const totalInput = getTotalInputTokens()
    const totalOutput = getTotalOutputTokens()
    const totalCacheRead = getTotalCacheReadInputTokens()
    const totalCacheCreation = getTotalCacheCreationInputTokens()
    const totalCost = getTotalCostUSD()
    const apiDuration = getTotalAPIDuration()
    const wallDuration = getTotalDuration()
    const linesAdded = getTotalLinesAdded()
    const linesRemoved = getTotalLinesRemoved()

    const modelUsageMap = getModelUsage()
    const totalSessionTokens = totalInput + totalOutput + totalCacheRead + totalCacheCreation

    return {
      contextWindow,
      effectiveContext,
      autoCompactThreshold,
      maxOutput,
      canonicalName,
      autoCompactEnabled,
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheCreation,
      totalCost,
      apiDuration,
      wallDuration,
      linesAdded,
      linesRemoved,
      modelUsageMap,
      totalSessionTokens,
    }
  }, [model])

  const barWidth = 40

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box flexDirection="row">
        <Text bold color="cyan">
          {figures.bullet} Context Window: {data.canonicalName}
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Window Capacity</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            {'  '}{figures.bullet} Context window:    {chalk.bold(formatNumber(data.contextWindow))} tokens
          </Text>
          <Text>
            {'  '}{figures.bullet} Effective context:  {chalk.bold(formatNumber(data.effectiveContext))} tokens
          </Text>
          <Text>
            {'  '}{figures.bullet} Max output:         {chalk.bold(formatNumber(data.maxOutput.default))} tokens
            {data.maxOutput.default !== data.maxOutput.upperLimit &&
              ` (up to ${formatNumber(data.maxOutput.upperLimit)})`}
          </Text>
          {data.autoCompactEnabled && (
            <Text>
              {'  '}{figures.bullet} Auto-compact at:    {chalk.bold(formatNumber(data.autoCompactThreshold))} tokens
            </Text>
          )}
        </Box>
      </Box>

      {data.totalSessionTokens > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Session Token Usage</Text>
          <Box marginTop={1} flexDirection="column">
            <CategoryRow
              label="Input"
              tokens={data.totalInput}
              total={data.totalSessionTokens}
              barWidth={barWidth}
              color="blue"
            />
            <CategoryRow
              label="Output"
              tokens={data.totalOutput}
              total={data.totalSessionTokens}
              barWidth={barWidth}
              color="green"
            />
            {data.totalCacheRead > 0 && (
              <CategoryRow
                label="Cache read"
                tokens={data.totalCacheRead}
                total={data.totalSessionTokens}
                barWidth={barWidth}
                color="cyan"
              />
            )}
            {data.totalCacheCreation > 0 && (
              <CategoryRow
                label="Cache write"
                tokens={data.totalCacheCreation}
                total={data.totalSessionTokens}
                barWidth={barWidth}
                color="yellow"
              />
            )}
            <Box flexDirection="row" marginTop={1}>
              <Text>
                {'  '}{'Total:'.padStart(10)} {chalk.bold(formatNumber(data.totalSessionTokens))} tokens
              </Text>
            </Box>
          </Box>
        </Box>
      )}

      {Object.keys(data.modelUsageMap).length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Per-Model Breakdown</Text>
          <Box marginTop={1} flexDirection="column">
            {Object.entries(data.modelUsageMap).map(([model, usage]) => {
              const shortName = getCanonicalName(model)
              const modelTotal = usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens
              return (
                <Box key={model} flexDirection="column">
                  <Text>
                    {'  '}{chalk.bold(shortName)}: {formatNumber(usage.inputTokens)} in, {formatNumber(usage.outputTokens)} out
                    {usage.cacheReadInputTokens > 0 && `, ${formatNumber(usage.cacheReadInputTokens)} cache read`}
                    {usage.cacheCreationInputTokens > 0 && `, ${formatNumber(usage.cacheCreationInputTokens)} cache write`}
                    {usage.costUSD > 0 && ` (${chalk.yellow(`$${usage.costUSD.toFixed(4)}`)})`}
                  </Text>
                </Box>
              )
            })}
          </Box>
        </Box>
      )}

      {(data.totalCost > 0 || data.linesAdded > 0) && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Session Summary</Text>
          <Box marginTop={1} flexDirection="column">
            {data.totalCost > 0 && (
              <Text>
                {'  '}{figures.bullet} Cost:          {chalk.bold(chalk.yellow(`$${data.totalCost.toFixed(4)}`))}
              </Text>
            )}
            {data.apiDuration > 0 && (
              <Text>
                {'  '}{figures.bullet} API duration:  {chalk.bold(formatDuration(data.apiDuration))}
              </Text>
            )}
            {data.wallDuration > 0 && (
              <Text>
                {'  '}{figures.bullet} Wall duration: {chalk.bold(formatDuration(data.wallDuration))}
              </Text>
            )}
            {(data.linesAdded > 0 || data.linesRemoved > 0) && (
              <Text>
                {'  '}{figures.bullet} Code changes:  {chalk.green(`+${data.linesAdded}`)} / {chalk.red(`-${data.linesRemoved}`)} lines
              </Text>
            )}
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {figures.info} Run /cost for pricing details, /compact to manually compact, /stats for historical stats
        </Text>
      </Box>
    </Box>
  )
}
