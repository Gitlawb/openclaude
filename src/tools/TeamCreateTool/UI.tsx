import React from 'react';
import type { Input } from './TeamCreateTool.js';
export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  return `create team: ${input.team_name}`;
}
