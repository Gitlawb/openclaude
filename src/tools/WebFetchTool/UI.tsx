import React from 'react';
import { MessageResponse } from '../../components/MessageResponse.js';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js';
import { Box, Text } from '../../ink.js';
import type { ToolProgressData } from '../../Tool.js';
import type { ProgressMessage } from '../../types/message.js';
import { formatFileSize, truncate } from '../../utils/format.js';
import type { Output } from './WebFetchTool.js';

export function renderToolUseMessage({
  url,
  prompt
}: Partial<{
  url: string;
  prompt: string;
}>, {
  verbose
}: {
  theme?: string;
  verbose: boolean;
}): React.ReactNode {
  if (!url) {
    return null;
  }
  if (verbose) {
    return `url: "${url}"${verbose && prompt ? `, prompt: "${prompt}"` : ''}`;
  }
  return url;
}

export function renderToolUseProgressMessage(
  progressMessages: ProgressMessage<ToolProgressData>[],
): React.ReactNode {
  if (progressMessages.length > 0) {
    const lastProgress = progressMessages[progressMessages.length - 1];
    if (lastProgress?.data && typeof lastProgress.data === 'object' && 'step' in lastProgress.data) {
      const step = (lastProgress.data as { step: string }).step;
      return <MessageResponse height={1}>
        <Text dimColor>{step}</Text>
      </MessageResponse>;
    }
  }
  return <MessageResponse height={1}>
      <Text dimColor>Fetching…</Text>
    </MessageResponse>;
}

export function renderToolResultMessage(
  output: Output,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const formattedSize = formatFileSize(output.bytes);
  const durationSec = (output.durationMs / 1000);
  const timeDisplay = durationSec >= 1 ? `${Math.round(durationSec)}s` : `${Math.round(durationSec * 1000)}ms`;

  let hostname: string
  try { hostname = new URL(output.url).hostname } catch { hostname = output.url }

  if (verbose) {
    return <Box flexDirection="column">
        <MessageResponse height={1}>
          <Text>
            Fetched <Text bold>{formattedSize}</Text> from {hostname} ({output.code} {output.codeText}) in {timeDisplay}
          </Text>
        </MessageResponse>
        <Box flexDirection="column">
          <Text>{output.result}</Text>
        </Box>
      </Box>;
  }
  return <Box justifyContent="space-between" width="100%">
      <MessageResponse height={1}>
        <Text>
          Fetched <Text bold>{formattedSize}</Text> in {timeDisplay}
        </Text>
      </MessageResponse>
    </Box>;
}

export function getToolUseSummary(input: Partial<{
  url: string;
  prompt: string;
}> | undefined): string | null {
  if (!input?.url) {
    return null;
  }
  return truncate(input.url, TOOL_SUMMARY_MAX_LENGTH);
}
