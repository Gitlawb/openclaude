import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import { extractTag } from '../../utils/messages.js';

type TestResult = {
  framework: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: string;
  failures: Array<{ name: string; file?: string; error?: string }>;
  command: string;
  rawOutput: string;
};

export function renderToolUseMessage(
  { command }: Partial<{ command: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!command) return null
  return `Running: ${command}`
}

export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!verbose && typeof result === 'string' && extractTag(result, 'tool_use_error')) {
    return <MessageResponse><Text color="error">Test execution failed</Text></MessageResponse>
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />
}

export function renderToolResultMessage(
  output: TestResult,
  _progressMessages: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const { framework, totalTests, passed, failed, skipped, duration, failures } = output

  if (totalTests === 0) {
    return <MessageResponse><Text dimColor>No tests found</Text></MessageResponse>
  }

  return (
    <Box flexDirection="column">
      <MessageResponse height={1}>
        <Text>
          {failed > 0 ? <Text color="error">{failed} failed</Text> : <Text color="success">All passed</Text>}
          <Text dimColor> · </Text>
          <Text>{passed}/{totalTests} passed</Text>
          {skipped > 0 && <Text dimColor> · {skipped} skipped</Text>}
          <Text dimColor> · {duration} · {framework}</Text>
        </Text>
      </MessageResponse>
      {failed > 0 && failures.length > 0 && (
        <Box marginLeft={2} flexDirection="column">
          {failures.slice(0, verbose ? failures.length : 5).map((f, i) => (
            <Text key={i}>
              <Text color="error">✕ </Text>
              <Text>{f.name}</Text>
              {f.file && <Text dimColor> ({f.file})</Text>}
            </Text>
          ))}
          {!verbose && failures.length > 5 && (
            <Text dimColor>  ...and {failures.length - 5} more (verbose to see all)</Text>
          )}
        </Box>
      )}
    </Box>
  )
}

export function getToolUseSummary(
  input: Partial<{ command: string }> | undefined,
): string | null {
  if (!input?.command) return null
  return input.command
}
