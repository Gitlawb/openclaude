import * as React from 'react'
import { useEffect, useState } from 'react'

import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import {
  buildMiniMaxUsageRows,
  fetchMiniMaxUsage,
  type MiniMaxUsageData,
  type MiniMaxUsageRow,
} from '../../services/api/minimaxUsage.js'
import { logError } from '../../utils/log.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'
import { Byline } from '../design-system/Byline.js'
import { ProgressBar } from '../design-system/ProgressBar.js'

const RESET_COUNTDOWN_REFRESH_MS = 30_000
const PROGRESS_BAR_WIDTH = 18

type MiniMaxUsageLimitBarProps = {
  label: string
  usedPercent: number
  resetsAt?: string
  extraSubtext?: string
  maxWidth: number
  nowMs: number
}

function formatCountdownDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000))
  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }

  return `${minutes}m`
}

function formatResetCountdown(
  resetsAt: string | undefined,
  nowMs: number,
): string | undefined {
  if (!resetsAt) return undefined

  const resetMs = Date.parse(resetsAt)
  if (!Number.isFinite(resetMs)) return undefined

  const remainingMs = resetMs - nowMs
  if (remainingMs <= 0) {
    return 'Resetting now'
  }

  return `Resets in ${formatCountdownDuration(remainingMs)}`
}

function MiniMaxUsageLimitBar({
  label,
  usedPercent,
  resetsAt,
  extraSubtext,
  maxWidth,
  nowMs,
}: MiniMaxUsageLimitBarProps): React.ReactNode {
  const normalizedUsedPercent = Math.max(0, Math.min(100, usedPercent))
  const usedText = `${Math.floor(normalizedUsedPercent)}% used`
  const resetText = formatResetCountdown(resetsAt, nowMs)
  const details = [usedText, extraSubtext].filter(
    (part): part is string => Boolean(part),
  )

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{label}</Text>
        {resetText ? <Text dimColor> · {resetText}</Text> : null}
      </Text>
      <Box flexDirection="row" gap={1}>
        <ProgressBar
          ratio={normalizedUsedPercent / 100}
          width={Math.min(PROGRESS_BAR_WIDTH, Math.max(1, maxWidth))}
          fillColor="rate_limit_fill"
          emptyColor="rate_limit_empty"
        />
        {details.length > 0 ? <Text dimColor>{details.join(' · ')}</Text> : null}
      </Box>
    </Box>
  )
}

function MiniMaxUsageTextRow({
  label,
  value,
}: Extract<MiniMaxUsageRow, { kind: 'text' }>): React.ReactNode {
  if (!value) {
    return <Text bold>{label}</Text>
  }

  return (
    <Text>
      <Text bold>{label}</Text>
      <Text dimColor> · {value}</Text>
    </Text>
  )
}

export function MiniMaxUsage(): React.ReactNode {
  const [usage, setUsage] = useState<MiniMaxUsageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const { columns } = useTerminalSize()
  const availableWidth = columns - 2
  const maxWidth = Math.min(availableWidth, 80)

  const loadUsage = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      setUsage(await fetchMiniMaxUsage())
    } catch (err) {
      logError(err as Error)
      setError(
        err instanceof Error ? err.message : 'Failed to load MiniMax usage',
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUsage()
  }, [loadUsage])

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now())
    }, RESET_COUNTDOWN_REFRESH_MS)

    return () => clearInterval(interval)
  }, [])

  useKeybinding(
    'settings:retry',
    () => {
      void loadUsage()
    },
    {
      context: 'Settings',
      isActive: !!error && !isLoading,
    },
  )

  if (error) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="error">Error: {error}</Text>
        <Text dimColor>
          <Byline>
            <ConfigurableShortcutHint
              action="settings:retry"
              context="Settings"
              fallback="r"
              description="retry"
            />
            <ConfigurableShortcutHint
              action="confirm:no"
              context="Settings"
              fallback="Esc"
              description="cancel"
            />
          </Byline>
        </Text>
      </Box>
    )
  }

  if (!usage) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Loading MiniMax usage data…</Text>
        <Text dimColor>
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Settings"
            fallback="Esc"
            description="cancel"
          />
        </Text>
      </Box>
    )
  }

  const rows =
    usage.availability === 'available'
      ? buildMiniMaxUsageRows(usage.snapshots)
      : []

  return (
    <Box flexDirection="column" gap={1} width="100%">
      {usage.planType ? <Text dimColor>Plan: {usage.planType}</Text> : null}

      {usage.availability === 'unknown' ? (
        <Text dimColor>{usage.message}</Text>
      ) : rows.length === 0 ? (
        <Text dimColor>
          No MiniMax usage windows were returned for this account.
        </Text>
      ) : null}

      {rows.map((row, index) =>
        row.kind === 'window' ? (
          <MiniMaxUsageLimitBar
            key={`${row.label}-${index}`}
            label={row.label}
            usedPercent={row.usedPercent}
            resetsAt={row.resetsAt}
            extraSubtext={row.extraSubtext}
            maxWidth={maxWidth}
            nowMs={nowMs}
          />
        ) : (
          // @ts-expect-error TS2741
          <MiniMaxUsageTextRow
            key={`${row.label}-${index}`}
            label={row.label}
            value={row.value}
          />
        ),
      )}

      <Text dimColor>
        <ConfigurableShortcutHint
          action="confirm:no"
          context="Settings"
          fallback="Esc"
          description="cancel"
        />
      </Text>
    </Box>
  )
}
