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
import { formatResetText } from '../../utils/format.js'
import { logError } from '../../utils/log.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'
import { Byline } from '../design-system/Byline.js'
import { ProgressBar } from '../design-system/ProgressBar.js'

type MiniMaxUsageLimitBarProps = {
  label: string
  usedPercent: number
  resetsAt?: string
  extraSubtext?: string
  maxWidth: number
}

function MiniMaxUsageLimitBar({
  label,
  usedPercent,
  resetsAt,
  extraSubtext,
  maxWidth,
}: MiniMaxUsageLimitBarProps): React.ReactNode {
  const normalizedUsedPercent = Math.max(0, Math.min(100, usedPercent))
  const usedText = `${Math.floor(normalizedUsedPercent)}% used`
  let subtext = resetsAt
    ? `Resets ${formatResetText(resetsAt, true, true)}`
    : undefined

  if (extraSubtext) {
    subtext = subtext ? `${extraSubtext} · ${subtext}` : extraSubtext
  }

  if (maxWidth >= 62) {
    return (
      <Box flexDirection="column">
        <Text bold>{label}</Text>
        <Box flexDirection="row" gap={1}>
          <ProgressBar
            ratio={normalizedUsedPercent / 100}
            width={50}
            fillColor="rate_limit_fill"
            emptyColor="rate_limit_empty"
          />
          <Text>{usedText}</Text>
        </Box>
        {subtext ? <Text dimColor>{subtext}</Text> : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{label}</Text>
        {subtext ? (
          <>
            <Text> </Text>
            <Text dimColor>· {subtext}</Text>
          </>
        ) : null}
      </Text>
      <ProgressBar
        ratio={normalizedUsedPercent / 100}
        width={maxWidth}
        fillColor="rate_limit_fill"
        emptyColor="rate_limit_empty"
      />
      <Text>{usedText}</Text>
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
          />
        ) : (
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
