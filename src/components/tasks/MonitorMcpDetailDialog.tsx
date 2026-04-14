/**
 * Detail dialog for monitor_mcp background tasks.
 *
 * Follows the same pattern as ShellDetailDialog / DreamDetailDialog:
 * Dialog wrapper + status / runtime / description + keyboard shortcuts.
 *
 * monitor_mcp is a forward-compatibility task type for MCP-based monitoring.
 * The actual streaming output lives on local_bash tasks with kind='monitor'
 * (shown via ShellDetailDialog). This dialog shows the mcp-level task state.
 */

import React, { Suspense, use, useDeferredValue, useEffect, useState } from 'react'
import type { DeepImmutable } from 'src/types/utils.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { Box, Text } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import type { MonitorMcpTaskState } from '../../tasks/MonitorMcpTask/MonitorMcpTask.js'
import { formatDuration } from '../../utils/format.js'
import { tailFile } from '../../utils/fsOperations.js'
import { getTaskOutputPath } from '../../utils/task/diskOutput.js'
import { Byline } from '../design-system/Byline.js'
import { Dialog } from '../design-system/Dialog.js'
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js'

type Props = {
  task: DeepImmutable<MonitorMcpTaskState>
  onKill?: () => void
  onBack?: () => void
}

const TAIL_BYTES = 4096

type OutputResult = { content: string; bytesTotal: number }

async function getTaskOutput(
  taskId: string,
): Promise<OutputResult> {
  const path = getTaskOutputPath(taskId)
  try {
    const result = await tailFile(path, TAIL_BYTES)
    return { content: result.content, bytesTotal: result.bytesTotal }
  } catch {
    return { content: '', bytesTotal: 0 }
  }
}

export function MonitorMcpDetailDialog({ task, onKill, onBack }: Props) {
  const { columns } = useTerminalSize()

  // Poll output while running
  const [outputPromise, setOutputPromise] = useState(
    () => getTaskOutput(task.id),
  )
  const deferredOutput = useDeferredValue(outputPromise)

  useEffect(() => {
    if (task.status !== 'running') return
    const timer = setInterval(() => {
      setOutputPromise(getTaskOutput(task.id))
    }, 1000)
    return () => clearInterval(timer)
  }, [task.id, task.status])

  // Enter/Space close — reuse Dialog's onCancel for Esc
  const handleClose = () => onBack?.()
  useKeybindings(
    { 'confirm:yes': handleClose },
    { context: 'Confirmation' },
  )

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault()
      handleClose()
    } else if (e.key === 'left' && onBack) {
      e.preventDefault()
      onBack()
    } else if (e.key === 'x' && task.status === 'running' && onKill) {
      e.preventDefault()
      onKill()
    }
  }

  const runtime = formatDuration(
    (task.endTime ?? Date.now()) - task.startTime,
  )

  const inputGuide = (exitState: { pending: boolean; keyName: string }) =>
    exitState.pending ? (
      <Text>Press {exitState.keyName} again to exit</Text>
    ) : (
      <Byline>
        {onBack && <KeyboardShortcutHint shortcut="←" action="go back" />}
        <KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />
        {task.status === 'running' && onKill && (
          <KeyboardShortcutHint shortcut="x" action="stop" />
        )}
      </Byline>
    )

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title="Monitor details"
        onCancel={handleClose}
        color="background"
        inputGuide={inputGuide}
      >
        <Box flexDirection="column">
          <Text>
            <Text bold>Status:</Text>{' '}
            {task.status === 'running' ? (
              <Text color="background">{task.status}</Text>
            ) : task.status === 'completed' ? (
              <Text color="success">{task.status}</Text>
            ) : (
              <Text color="error">{task.status}</Text>
            )}
          </Text>
          <Text>
            <Text bold>Runtime:</Text> {runtime}
          </Text>
          <Text wrap="wrap">
            <Text bold>Description:</Text> {task.description}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text bold>Output:</Text>
          <Suspense fallback={<Text dimColor>Loading output…</Text>}>
            <OutputContent outputPromise={deferredOutput} columns={columns} />
          </Suspense>
        </Box>
      </Dialog>
    </Box>
  )
}

function OutputContent({
  outputPromise,
  columns,
}: {
  outputPromise: Promise<OutputResult>
  columns: number
}) {
  const { content, bytesTotal } = use(outputPromise)

  if (!content) {
    return <Text dimColor>No output available</Text>
  }

  // Show last 10 lines
  const lines: string[] = []
  let pos = content.length
  for (let i = 0; i < 10 && pos > 0; i++) {
    const prev = content.lastIndexOf('\n', pos - 1)
    const line = content.slice(prev + 1, pos)
    if (line) lines.unshift(line)
    pos = prev
  }

  return (
    <>
      <Box
        borderStyle="round"
        paddingX={1}
        flexDirection="column"
        height={12}
        maxWidth={columns - 6}
      >
        {lines.map((line, i) => (
          <Text key={i} wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>
      <Text dimColor italic>
        Showing {lines.length} lines
        {bytesTotal > content.length
          ? ` of ${bytesTotal} bytes`
          : ''}
      </Text>
    </>
  )
}
