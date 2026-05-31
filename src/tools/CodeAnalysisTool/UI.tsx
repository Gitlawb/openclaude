import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import { extractTag } from '../../utils/messages.js';

type CodeAnalysisResult = {
  operation: string;
  summary: string;
  details: string;
};

export function renderToolUseMessage(
  input: Partial<{ operation: string; path?: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { operation, path } = input
  const parts = [`operation: ${operation}`]
  if (path) parts.push(`path: ${path}`)
  return parts.join(', ')
}

export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!verbose && typeof result === 'string' && extractTag(result, 'tool_use_error')) {
    return <MessageResponse><Text color="error">Code analysis failed</Text></MessageResponse>
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />
}

export function renderToolResultMessage(
  output: CodeAnalysisResult,
  _progressMessages: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { operation, summary, details } = output
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
          <Text>{details.length > 3000 ? details.substring(0, 3000) + '\n...(truncated)' : details}</Text>
        </Box>
      )}
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ operation: string; path?: string }> | undefined,
): string | null {
  if (!input?.operation) return null
  return input.path ? `${input.operation} ${input.path}` : input.operation
}
