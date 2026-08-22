import * as React from 'react'
import { useCallback, useState } from 'react'
import { Box, Text, useInput } from '../ink.js'
import type { Tool } from '../Tool.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { Pane } from './design-system/Pane.js'

type ToolMode = 'always' | 'ask' | 'auto' | 'off'

const MODES: ToolMode[] = ['auto', 'always', 'ask', 'off']

function nextMode(current: ToolMode): ToolMode {
  const idx = MODES.indexOf(current)
  return MODES[(idx + 1) % MODES.length]!
}

function modeBadge(mode: ToolMode): React.ReactNode {
  switch (mode) {
    case 'always':
      return <Text color="green" bold>[always]</Text>
    case 'ask':
      return <Text color="yellow" bold>[ask]</Text>
    case 'auto':
      return <Text color="blue" bold>[auto]</Text>
    case 'off':
      return <Text color="red" bold>[off]</Text>
  }
}

type Props = {
  tools: readonly Tool[]
  onClose: (result?: string) => void
}

export function ToolModeManager({ tools, onClose }: Props): React.ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [modes, setModes] = useState<Record<string, ToolMode>>(() => {
    const config = getGlobalConfig()
    return config.toolModes ?? {}
  })

  const getMode = useCallback(
    (toolName: string): ToolMode => modes[toolName] ?? 'auto',
    [modes],
  )

  const cycleMode = useCallback(
    (toolName: string) => {
      const current = getMode(toolName)
      const next = nextMode(current)
      const updated = { ...modes }
      if (next === 'auto') {
        delete updated[toolName]
      } else {
        updated[toolName] = next
      }
      setModes(updated)
      saveGlobalConfig(config => ({
        ...config,
        toolModes: Object.keys(updated).length > 0 ? updated : undefined,
      }))
    },
    [modes, getMode],
  )

  useInput((input, key) => {
    if (key.escape) {
      onClose('Tool mode manager closed')
      return
    }
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIndex(i => Math.min(tools.length - 1, i + 1))
      return
    }
    if (key.return || input === ' ') {
      const tool = tools[selectedIndex]
      if (tool) {
        cycleMode(tool.name)
      }
      return
    }
  })

  const selectedTool = tools[selectedIndex]

  // Compute visible window (scroll if needed)
  const maxVisible = 15
  let startIdx = 0
  if (tools.length > maxVisible) {
    startIdx = Math.max(
      0,
      Math.min(selectedIndex - Math.floor(maxVisible / 2), tools.length - maxVisible),
    )
  }
  const visibleTools = tools.slice(startIdx, startIdx + maxVisible)

  return (
    <Pane color="permission">
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Tool Mode Manager</Text>
          <Text dimColor> — ↑↓ navigate, Space/Enter cycle mode, Esc close</Text>
        </Box>

        {visibleTools.map((tool, i) => {
          const actualIndex = startIdx + i
          const isSelected = actualIndex === selectedIndex
          const mode = getMode(tool.name)
          return (
            <Box key={tool.name}>
              <Text>{isSelected ? '❯ ' : '  '}</Text>
              <Text bold={isSelected}>{tool.name}</Text>
              <Text> </Text>
              {modeBadge(mode)}
            </Box>
          )
        })}

        {tools.length > maxVisible && (
          <Box marginTop={1}>
            <Text dimColor>
              Showing {startIdx + 1}–{Math.min(startIdx + maxVisible, tools.length)} of {tools.length} tools
            </Text>
          </Box>
        )}

        {selectedTool && (
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              {selectedTool.name}: {'off'} disables the tool entirely; other modes are display-only for now
            </Text>
          </Box>
        )}
      </Box>
    </Pane>
  )
}
