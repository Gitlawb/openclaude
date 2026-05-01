import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import React from 'react'
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js'
import { Text } from '../../ink.js'
import type { ToolProgressData } from '../../Tool.js'
import type { ProgressMessage } from '../../types/message.js'
import { truncate } from '../../utils/format.js'

type Output = {
  rendered: string
  token_count: number
  file_count: number
  total_file_count: number
  cache_hit: boolean
  build_time_ms: number
}

export function getToolUseSummary(
  input:
    | Partial<{
        max_tokens?: number
        focus_files?: string[]
        focus_symbols?: string[]
      }>
    | undefined,
): string | null {
  if (!input) return 'Repository map'
  const parts: string[] = []
  if (input.focus_files?.length) {
    parts.push(input.focus_files.join(', '))
  }
  if (input.focus_symbols?.length) {
    parts.push(input.focus_symbols.join(', '))
  }
  if (parts.length > 0) {
    return truncate(`Repository map (focus: ${parts.join('; ')})`, TOOL_SUMMARY_MAX_LENGTH)
  }
  return 'Repository map'
}

export function renderToolUseMessage(
  input: Partial<{
    max_tokens?: number
    focus_files?: string[]
    focus_symbols?: string[]
  }>,
): React.ReactNode {
  const parts: string[] = []
  if (input.max_tokens) {
    parts.push(`max_tokens: ${input.max_tokens}`)
  }
  if (input.focus_files?.length) {
    parts.push(`focus: ${input.focus_files.join(', ')}`)
  }
  if (input.focus_symbols?.length) {
    parts.push(`symbols: ${input.focus_symbols.join(', ')}`)
  }
  return parts.length > 0 ? parts.join(', ') : null
}

export function renderToolResultMessage(
  output: Output,
  _progressMessages: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const summary = `${output.file_count} files ranked, ${output.token_count} tokens${output.cache_hit ? ' (cached)' : `, ${output.build_time_ms}ms`}`

  if (verbose) {
    return (
      <MessageResponse>
        <Text>
          Built repository map: {summary}
          {'\n'}
          ({output.total_file_count} total files considered)
        </Text>
      </MessageResponse>
    )
  }

  return (
    <MessageResponse height={1}>
      <Text>
        Built repository map: {summary}
      </Text>
    </MessageResponse>
  )
}

export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />
}
