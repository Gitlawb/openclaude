import React from 'react';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Text } from '../../ink.js';
import { jsonParse } from '../../utils/slowOperations.js';
import type { Input, SendMessageToolOutput } from './SendMessageTool.js';
export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  if (typeof input.message !== 'object' || input.message === null) {
    return null;
  }
  if (input.message.type === 'plan_approval_response') {
    return input.message.approve ? `approve plan from: ${input.to}` : `reject plan from: ${input.to}`;
  }
  return null;
}
export function renderToolResultMessage(content: SendMessageToolOutput | string, _progressMessages: unknown, {
  verbose
}: {
  verbose: boolean;
}): React.ReactNode {
  const result: SendMessageToolOutput = typeof content === 'string' ? jsonParse(content) : content;
  if ('routing' in result && result.routing) {
    return null;
  }
  if ('request_id' in result && 'target' in result) {
    return null;
  }
  return <MessageResponse>
      <Text dimColor>{result.message}</Text>
    </MessageResponse>;
}
