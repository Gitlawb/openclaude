import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import { extractTag } from '../../utils/messages.js';

type GitAnalysisResult = {
  operation: string;
  result: string;
  summary: string;
};

export function renderToolUseMessage(
  input: Partial<{ operation: string; file?: string; query?: string; commit?: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { operation, file, query, commit } = input
  const parts = [`operation: ${operation}`]
  if (file) parts.push(`file: ${file}`)
  if (query) parts.push(`query: "${query}"`)
  if (commit) parts.push(`commit: ${commit}`)
  return parts.join(', ')
}

export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!verbose && typeof result === 'string' && extractTag(result, 'tool_use_error')) {
    return <MessageResponse><Text color="error">Git analysis failed</Text></MessageResponse>
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />
}

export function renderToolResultMessage(
  output: GitAnalysisResult,
  _progressMessages: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { operation, summary, result } = output
  return (
    <Box flexDirection="column">
      <MessageResponse height={1}>
        <Text>
          <Text bold>{operation}</Text>
          <Text dimColor> · </Text>
          <Text>{summary}</Text>
        </Text>
      </MessageResponse>
      {verbose && (
        <Box marginLeft={2}>
          <Text>{result.length > 2000 ? result.substring(0, 2000) + '\n...(truncated)' : result}</Text>
        </Box>
      )}
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ operation: string; file?: string; query?: string }> | undefined,
): string | null {
  if (!input?.operation) return null
  const parts = [input.operation]
  if (input.file) parts.push(input.file)
  if (input.query) parts.push(`"${input.query}"`)
  return parts.join(' ')
}
