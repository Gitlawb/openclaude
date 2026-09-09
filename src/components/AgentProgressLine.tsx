import React from 'react'
import { Box, Text } from '../ink.js'
import { formatNumber } from '../utils/format.js'
import { agentUsageDisplay, type AgentTokenUsage } from '../utils/agentUsage.js'
import type { Theme } from '../utils/theme.js'
import { agentStatusLabel, type AgentDisplayStatus } from './agentPresentation.js'

type Props = {
  agentType: string; description?: string; name?: string; descriptionColor?: keyof Theme;
  taskDescription?: string; toolUseCount: number; tokens: number | null; tokenUsage?: AgentTokenUsage;
  color?: keyof Theme; isLast: boolean; isResolved: boolean; isError: boolean; isAsync?: boolean;
  shouldAnimate: boolean; lastToolInfo?: string | null; hideType?: boolean;
  compact?: boolean; width?: number; status?: AgentDisplayStatus;
}

export function AgentProgressLine(props: Props) {
  const status = props.status ?? (props.isError ? 'failed' : props.isAsync && props.isResolved ? 'backgrounded' : props.isResolved ? 'completed' : 'running')
  const label = agentStatusLabel(status, props.lastToolInfo)
  const title = props.hideType ? props.name ?? props.description ?? props.agentType : `${props.agentType}${props.description ? ` (${props.description})` : ''}`
  const usage = agentUsageDisplay(props.tokenUsage, props.tokens, formatNumber)
  return <Box flexDirection="column" width={props.width}>
    <Box height={1} paddingLeft={3} overflow="hidden">
      <Box width={3} flexShrink={0}><Text dimColor>{props.isLast ? '└─ ' : '├─ '}</Text></Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        <Text wrap="truncate-end" color={status === 'failed' ? 'error' : props.color}>
          {props.compact && `${label} · `}<Text bold>{title}</Text>
        </Text>
      </Box>
      <Box flexShrink={0}><Text dimColor>{` · ${props.compact ? '' : `${props.toolUseCount} tool ${props.toolUseCount === 1 ? 'use' : 'uses'} · `}${usage}`}</Text></Box>
    </Box>
    {!props.compact && <Box height={1} paddingLeft={3} overflow="hidden">
      <Box width={6} flexShrink={0}><Text dimColor>{props.isLast ? '   └  ' : '│  └  '}</Text></Box><Text wrap="truncate-end" dimColor>{label}</Text>
    </Box>}
  </Box>
}
