import * as React from 'react';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Text } from '../../ink.js';
import { truncateToWidth } from '../format.js';
import type { MCPToolResult } from '../mcpValidation.js';
type CuToolInput = Record<string, unknown> & {
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  apps?: Array<{
    displayName?: string;
  }>;
  region?: [number, number, number, number];
  direction?: string;
  amount?: number;
  duration?: number;
};
function fmtCoord(c: [number, number] | undefined): string {
  return c ? `(${c[0]}, ${c[1]})` : '';
}
const RESULT_SUMMARY: Readonly<Partial<Record<string, string>>> = {
  screenshot: 'Captured',
  zoom: 'Captured',
  request_access: 'Access updated',
  left_click: 'Clicked',
  right_click: 'Clicked',
  middle_click: 'Clicked',
  double_click: 'Clicked',
  triple_click: 'Clicked',
  type: 'Typed',
  key: 'Pressed',
  hold_key: 'Pressed',
  scroll: 'Scrolled',
  left_click_drag: 'Dragged',
  open_application: 'Opened'
};

/**
 * Rendering overrides for `mcp__computer-use__*` tools. Spread into the MCP
 * tool object in `client.ts` after the default `userFacingName`, so these win.
 * Mirror of `getClaudeInChromeMCPToolOverrides`.
 */
export function getComputerUseMCPRenderingOverrides(toolName: string): {
  userFacingName: () => string;
  renderToolUseMessage: (input: Record<string, unknown>, options: {
    verbose: boolean;
  }) => React.ReactNode;
  renderToolResultMessage: (output: MCPToolResult, progressMessages: unknown[], options: {
    verbose: boolean;
  }) => React.ReactNode;
} {
  return {
    userFacingName() {
      return `Computer Use[${toolName}]`;
    },
    // AssistantToolUseMessage.tsx contract: null hides the ENTIRE row, '' shows
    // the tool name without "(args)". Every path below returns '' when there's
    // nothing to show — never null.
    renderToolUseMessage(input: CuToolInput) {
      switch (toolName) {
        case 'screenshot':
        case 'left_mouse_down':
        case 'left_mouse_up':
        case 'cursor_position':
        case 'list_granted_applications':
        case 'read_clipboard':
          return '';
        case 'left_click':
        case 'right_click':
        case 'middle_click':
        case 'double_click':
        case 'triple_click':
        case 'mouse_move':
          return fmtCoord(input.coordinate);
        case 'left_click_drag':
          return input.start_coordinate ? `${fmtCoord(input.start_coordinate)} → ${fmtCoord(input.coordinate)}` : `to ${fmtCoord(input.coordinate)}`;
        case 'type':
          return typeof input.text === 'string' ? `"${truncateToWidth(input.text, 40)}"` : '';
        case 'key':
        case 'hold_key':
          return typeof input.text === 'string' ? input.text : '';
        case 'scroll':
          return [input.direction, input.amount && `×${input.amount}`, input.coordinate && `at ${fmtCoord(input.coordinate)}`].filter(Boolean).join(' ');
        case 'zoom':
          {
            const r = input.region;
            return Array.isArray(r) && r.length === 4 ? `[${r[0]}, ${r[1]}, ${r[2]}, ${r[3]}]` : '';
          }
        case 'wait':
          return typeof input.duration === 'number' ? `${input.duration}s` : '';
        case 'write_clipboard':
          return typeof input.text === 'string' ? `"${truncateToWidth(input.text, 40)}"` : '';
        case 'open_application':
          return typeof input.bundle_id === 'string' ? String(input.bundle_id) : '';
        case 'request_access':
          {
            const apps = input.apps;
            if (!Array.isArray(apps)) return '';
            const names = apps.map(a => typeof a?.displayName === 'string' ? a.displayName : '').filter(Boolean);
            return names.join(', ');
          }
        case 'computer_batch':
          {
            const actions = input.actions;
            return Array.isArray(actions) ? `${actions.length} actions` : '';
          }
        default:
          return '';
      }
    },
    renderToolResultMessage(output, _progress, {
      verbose
    }) {
      if (verbose || typeof output !== 'object' || output === null) return null;

      // Non-verbose: one-line dim summary, like Chrome's pattern.
      const summary = RESULT_SUMMARY[toolName];
      if (!summary) return null;
      return <MessageResponse height={1}>
          <Text dimColor>{summary}</Text>
        </MessageResponse>;
    }
  };
}
