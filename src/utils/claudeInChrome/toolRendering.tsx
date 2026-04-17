import * as React from 'react';
import { MessageResponse } from '../../components/MessageResponse.js';
import { supportsHyperlinks } from '../../ink/supports-hyperlinks.js';
import { Link, Text } from '../../ink.js';
import { renderToolResultMessage as renderDefaultMCPToolResultMessage } from '../../tools/MCPTool/UI.js';
import type { MCPToolResult } from '../../utils/mcpValidation.js';
import { truncateToWidth } from '../format.js';
import { trackClaudeInChromeTabId } from './common.js';
export type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * All tool names from BROWSER_TOOLS in @ant/claude-for-chrome-mcp.
 * Keep in sync with the package's BROWSER_TOOLS array.
 */
export type ChromeToolName = 'javascript_tool' | 'read_page' | 'find' | 'form_input' | 'computer' | 'navigate' | 'resize_window' | 'gif_creator' | 'upload_image' | 'get_page_text' | 'tabs_context_mcp' | 'tabs_create_mcp' | 'update_plan' | 'read_console_messages' | 'read_network_requests' | 'shortcuts_list' | 'shortcuts_execute';
const CHROME_EXTENSION_FOCUS_TAB_URL_BASE = 'https://clau.deEnable Chrome integration/tab/';
function renderChromeToolUseMessage(input: Record<string, unknown>, toolName: ChromeToolName, verbose: boolean): React.ReactNode {
  const tabId = input.tabId;
  if (typeof tabId === 'number') {
    trackClaudeInChromeTabId(tabId);
  }

  // Build secondary info based on tool type and input
  const secondaryInfo: string[] = [];
  switch (toolName) {
    case 'navigate':
      if (typeof input.url === 'string') {
        try {
          const url = new URL(input.url);
          secondaryInfo.push(url.hostname);
        } catch {
          secondaryInfo.push(truncateToWidth(input.url, 30));
        }
      }
      break;
    case 'find':
      if (typeof input.query === 'string') {
        secondaryInfo.push(`pattern: ${truncateToWidth(input.query, 30)}`);
      }
      break;
    case 'computer':
      if (typeof input.action === 'string') {
        const action = input.action;
        if (action === 'left_click' || action === 'right_click' || action === 'double_click' || action === 'middle_click') {
          if (typeof input.ref === 'string') {
            secondaryInfo.push(`${action} on ${input.ref}`);
          } else if (Array.isArray(input.coordinate)) {
            secondaryInfo.push(`${action} at (${input.coordinate.join(', ')})`);
          } else {
            secondaryInfo.push(action);
          }
        } else if (action === 'type' && typeof input.text === 'string') {
          secondaryInfo.push(`type "${truncateToWidth(input.text, 15)}"`);
        } else if (action === 'key' && typeof input.text === 'string') {
          secondaryInfo.push(`key ${input.text}`);
        } else if (action === 'scroll' && typeof input.scroll_direction === 'string') {
          secondaryInfo.push(`scroll ${input.scroll_direction}`);
        } else if (action === 'wait' && typeof input.duration === 'number') {
          secondaryInfo.push(`wait ${input.duration}s`);
        } else if (action === 'left_click_drag') {
          secondaryInfo.push('drag');
        } else {
          secondaryInfo.push(action);
        }
      }
      break;
    case 'gif_creator':
      if (typeof input.action === 'string') {
        secondaryInfo.push(`${input.action}`);
      }
      break;
    case 'resize_window':
      if (typeof input.width === 'number' && typeof input.height === 'number') {
        secondaryInfo.push(`${input.width}x${input.height}`);
      }
      break;
    case 'read_console_messages':
      if (typeof input.pattern === 'string') {
        secondaryInfo.push(`pattern: ${truncateToWidth(input.pattern, 20)}`);
      }
      if (input.onlyErrors === true) {
        secondaryInfo.push('errors only');
      }
      break;
    case 'read_network_requests':
      if (typeof input.urlPattern === 'string') {
        secondaryInfo.push(`pattern: ${truncateToWidth(input.urlPattern, 20)}`);
      }
      break;
    case 'shortcuts_execute':
      if (typeof input.shortcutId === 'string') {
        secondaryInfo.push(`shortcut_id: ${input.shortcutId}`);
      }
      break;
    case 'javascript_tool':
      // In verbose mode, show the full code
      if (verbose && typeof input.text === 'string') {
        return input.text;
      }
      // In non-verbose mode, return empty string to preserve View Tab layout
      return '';
    case 'tabs_create_mcp':
    case 'tabs_context_mcp':
    case 'form_input':
    case 'shortcuts_list':
    case 'read_page':
    case 'upload_image':
    case 'get_page_text':
    case 'update_plan':
      // These tools don't have meaningful secondary info to show inline.
      // Return empty string (not null) to ensure tool header still renders.
      return '';
  }
  return secondaryInfo.join(', ') || null;
}

/**
 * Renders a clickable "View Tab" link for Neural Network in Chrome MCP tools.
 * Returns null if:
 * - The tool is not a Neural Network in Chrome MCP tool
 * - The input doesn't have a valid tabId
 * - Hyperlinks are not supported
 */
function renderChromeViewTabLink(input: unknown): React.ReactNode {
  if (!supportsHyperlinks()) {
    return null;
  }
  if (typeof input !== 'object' || input === null || !('tabId' in input)) {
    return null;
  }
  const tabId = typeof input.tabId === 'number' ? input.tabId : typeof input.tabId === 'string' ? parseInt(input.tabId, 10) : NaN;
  if (isNaN(tabId)) {
    return null;
  }
  const linkUrl = `${CHROME_EXTENSION_FOCUS_TAB_URL_BASE}${tabId}`;
  return <Text>
      {' '}
      <Link url={linkUrl}>
        <Text color="subtle">[View Tab]</Text>
      </Link>
    </Text>;
}

/**
 * Custom tool result message rendering for claude-in-chrome tools.
 * Shows a brief summary for successful results. Errors are handled by
 * the default renderToolUseErrorMessage when is_error is set.
 */
export function renderChromeToolResultMessage(output: MCPToolResult, toolName: ChromeToolName, verbose: boolean): React.ReactNode {
  if (verbose) {
    return renderDefaultMCPToolResultMessage(output, [], {
      verbose
    });
  }
  let summary: string | null = null;
  switch (toolName) {
    case 'navigate':
      summary = 'Navigation completed';
      break;
    case 'tabs_create_mcp':
      summary = 'Tab created';
      break;
    case 'tabs_context_mcp':
      summary = 'Tabs read';
      break;
    case 'form_input':
      summary = 'Input completed';
      break;
    case 'computer':
      summary = 'Action completed';
      break;
    case 'resize_window':
      summary = 'Window resized';
      break;
    case 'find':
      summary = 'Search completed';
      break;
    case 'gif_creator':
      summary = 'GIF action completed';
      break;
    case 'read_console_messages':
      summary = 'Console messages retrieved';
      break;
    case 'read_network_requests':
      summary = 'Network requests retrieved';
      break;
    case 'shortcuts_list':
      summary = 'Shortcuts retrieved';
      break;
    case 'shortcuts_execute':
      summary = 'Shortcut executed';
      break;
    case 'javascript_tool':
      summary = 'Script executed';
      break;
    case 'read_page':
      summary = 'Page read';
      break;
    case 'upload_image':
      summary = 'Image uploaded';
      break;
    case 'get_page_text':
      summary = 'Page text retrieved';
      break;
    case 'update_plan':
      summary = 'Plan updated';
      break;
  }
  if (summary) {
    return <MessageResponse height={1}>
        <Text dimColor>{summary}</Text>
      </MessageResponse>;
  }
  return null;
}

/**
 * Returns tool method overrides for Neural Network in Chrome MCP tools. Use this to customize
 * rendering for chrome tools in a single spread operation.
 */
export function getClaudeInChromeMCPToolOverrides(toolName: string): {
  userFacingName: (input?: Record<string, unknown>) => string;
  renderToolUseMessage: (input: Record<string, unknown>, options: {
    verbose: boolean;
  }) => React.ReactNode;
  renderToolUseTag: (input: Partial<Record<string, unknown>>) => React.ReactNode;
  renderToolResultMessage: (output: string | MCPToolResult, progressMessagesForMessage: unknown[], options: {
    verbose: boolean;
  }) => React.ReactNode;
} {
  return {
    userFacingName(_input?: Record<string, unknown>) {
      // Trim the _mcp postfix that show up in some of the tool names
      const displayName = toolName.replace(/_mcp$/, '');
      return `Chrome Extension[${displayName}]`;
    },
    renderToolUseMessage(input: Record<string, unknown>, {
      verbose
    }: {
      verbose: boolean;
    }): React.ReactNode {
      return renderChromeToolUseMessage(input, toolName as ChromeToolName, verbose);
    },
    renderToolUseTag(input: Partial<Record<string, unknown>>): React.ReactNode {
      return renderChromeViewTabLink(input);
    },
    renderToolResultMessage(output: string | MCPToolResult, _progressMessagesForMessage: unknown[], {
      verbose
    }: {
      verbose: boolean;
    }): React.ReactNode {
      if (!isMCPToolResult(output)) {
        return null;
      }
      return renderChromeToolResultMessage(output, toolName as ChromeToolName, verbose);
    }
  };
}
function isMCPToolResult(output: string | MCPToolResult): output is MCPToolResult {
  return typeof output === 'object' && output !== null;
}
