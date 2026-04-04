import React from 'react';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Text } from '../../ink.js';
import { countCharInString } from '../../utils/stringUtils.js';
import type { Input, Output } from './RemoteTriggerTool.js';
export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  return `${input.action ?? ''}${input.trigger_id ? ` ${input.trigger_id}` : ''}`;
}
export function renderToolResultMessage(output: Output): React.ReactNode {
  const lines = countCharInString(output.json, '\n') + 1;
  return <MessageResponse>
      <Text>
        HTTP {output.status} <Text dimColor>({lines} lines)</Text>
      </Text>
    </MessageResponse>;
}
