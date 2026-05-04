import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import type { Message, ProgressMessage } from 'src/types/message.js';
import { extractTag } from 'src/utils/messages.js';
import type { ThemeName } from 'src/utils/theme.js';
import type { z } from 'zod/v4';
import { FallbackToolUseErrorMessage } from '../../components/FallbackToolUseErrorMessage.js';
import { FilePathLink } from '../../components/FilePathLink.js';
import { HighlightedCode } from '../../components/HighlightedCode.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { NotebookEditToolUseRejectedMessage } from '../../components/NotebookEditToolUseRejectedMessage.js';
import { Box, Text } from '../../ink.js';
import type { Tools } from '../../Tool.js';
import { getDisplayPath } from '../../utils/file.js';
import type { inputSchema, Output } from './NotebookEditTool.js';
export function getToolUseSummary(input: Partial<z.infer<ReturnType<typeof inputSchema>>> | undefined): string | null {
  if (!input?.notebook_path) {
    return null;
  }
  return getDisplayPath(input.notebook_path);
}
export function renderToolUseMessage({
  notebook_path,
  cell_id,
  new_source,
  cell_type,
  edit_mode
}: Partial<z.infer<ReturnType<typeof inputSchema>>>, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!notebook_path || !new_source || !cell_type) {
    return null;
  }
  const displayPath = verbose ? notebook_path : getDisplayPath(notebook_path);
  if (verbose) {
    return <>
        <FilePathLink filePath={notebook_path}>{displayPath}</FilePathLink>
        {`@${cell_id}, content: ${new_source.slice(0, 30)}…, cell_type: ${cell_type}, edit_mode: ${edit_mode ?? 'replace'}`}
      </>;
  }
  return <>
      <FilePathLink filePath={notebook_path}>{displayPath}</FilePathLink>
      {`@${cell_id}`}
    </>;
}
export function renderToolUseRejectedMessage(input: z.infer<ReturnType<typeof inputSchema>>, {
  verbose
}: {
  columns?: number;
  messages?: Message[];
  progressMessagesForMessage?: ProgressMessage[];
  theme?: ThemeName;
  tools?: Tools;
  verbose: boolean;
}): React.ReactNode {
  return <NotebookEditToolUseRejectedMessage notebook_path={input.notebook_path} cell_id={input.cell_id} new_source={input.new_source} cell_type={input.cell_type} edit_mode={input.edit_mode} verbose={verbose} />;
}
export function renderToolUseErrorMessage(result: ToolResultBlockParam['content'], {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  if (!verbose && typeof result === 'string' && extractTag(result, 'tool_use_error')) {
    return <MessageResponse>
        <Text color="error">Error editing notebook</Text>
      </MessageResponse>;
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}
export function renderToolResultMessage({
  cell_id,
  new_source,
  error
}: Output): React.ReactNode {
  if (error) {
    return <MessageResponse>
        <Text color="error">{error}</Text>
      </MessageResponse>;
  }
  return <MessageResponse>
      <Box flexDirection="column">
        <Text>
          Updated cell <Text bold>{cell_id}</Text>:
        </Text>
        <Box marginLeft={2}>
          <HighlightedCode // @ts-expect-error type mismatch
 code={new_source} filePath="notebook.py" />
        </Box>
      </Box>
    </MessageResponse>;
}
