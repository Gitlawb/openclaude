/**
 * OpenClaude for Chrome MCP — Browser tool definitions
 *
 * Each tool has a name, description, and JSON Schema inputSchema conforming
 * to the MCP Tool type from @modelcontextprotocol/sdk/types.js.
 *
 * Tool names must match the ChromeToolName union in
 * src/utils/claudeInChrome/toolRendering.tsx exactly.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export const BROWSER_TOOLS: Tool[] = [
  {
    name: 'tabs_context_mcp',
    description:
      'Get information about the current browser tabs. Call this at the start of a browser automation session to understand what tabs are available.',
    inputSchema: {
      type: 'object',
      properties: {
        createIfEmpty: {
          type: 'boolean',
          description:
            'If true and no tabs are open, create a new blank tab automatically.',
        },
      },
    },
  },
  {
    name: 'tabs_create_mcp',
    description: 'Create a new browser tab.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Optional URL to navigate to in the new tab.',
        },
      },
    },
  },
  {
    name: 'navigate',
    description: 'Navigate to a URL in a browser tab.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to.',
        },
        tabId: {
          type: 'number',
          description: 'The ID of the tab to navigate.',
        },
      },
      required: ['url', 'tabId'],
    },
  },
  {
    name: 'read_page',
    description:
      'Read the content or accessibility tree of a web page. Returns structural information about the page elements.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'The ID of the tab to read.',
        },
        depth: {
          type: 'number',
          description:
            'Maximum depth of the accessibility tree to return. Defaults to full depth.',
        },
        filter: {
          type: 'string',
          description: 'Filter expression to narrow results.',
        },
        max_chars: {
          type: 'number',
          description: 'Maximum number of characters to return.',
        },
        ref_id: {
          type: 'string',
          description:
            'Reference ID of a specific element to read instead of the full page.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'get_page_text',
    description:
      'Get the full text content of a page as plain text. Useful for reading long-form content without structural overhead.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'The ID of the tab to read.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'find',
    description:
      'Search for elements on the page matching a query. Returns matching elements with their reference IDs for interaction.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query or CSS selector to find elements.',
        },
        tabId: {
          type: 'number',
          description: 'The ID of the tab to search in.',
        },
      },
      required: ['query', 'tabId'],
    },
  },
  {
    name: 'form_input',
    description:
      'Fill in a form field identified by a reference ID with a given value.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: 'The reference ID of the form element to fill.',
        },
        value: {
          type: 'string',
          description: 'The value to set on the form element.',
        },
        tabId: {
          type: 'number',
          description: 'The ID of the tab containing the form.',
        },
      },
      required: ['ref', 'value', 'tabId'],
    },
  },
  {
    name: 'computer',
    description:
      'Perform low-level computer interactions: mouse clicks, keyboard input, scrolling, screenshots, drag, and wait. This is the primary tool for interacting with page elements.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'left_click',
            'right_click',
            'double_click',
            'middle_click',
            'type',
            'key',
            'scroll',
            'screenshot',
            'wait',
            'left_click_drag',
            'zoom',
          ],
          description: 'The action to perform.',
        },
        tabId: {
          type: 'number',
          description: 'The ID of the tab to act on.',
        },
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description:
            '[x, y] coordinate for click/drag actions. Alternative to ref.',
        },
        ref: {
          type: 'string',
          description:
            'Reference ID of the element to interact with. Alternative to coordinate.',
        },
        text: {
          type: 'string',
          description:
            'Text to type (for "type" action) or key combo (for "key" action, e.g. "Enter", "Control+c").',
        },
        scroll_direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Direction to scroll (for "scroll" action).',
        },
        scroll_amount: {
          type: 'number',
          description:
            'Number of scroll increments (for "scroll" action). Defaults to 3.',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds (for "wait" action).',
        },
        start_coordinate: {
          type: 'array',
          items: { type: 'number' },
          description:
            '[x, y] starting coordinate for drag actions.',
        },
        modifiers: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['Alt', 'Control', 'Meta', 'Shift'],
          },
          description: 'Modifier keys to hold during the action.',
        },
        region: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          description:
            'Region to capture for screenshot action. If omitted, captures the full viewport.',
        },
        repeat: {
          type: 'number',
          description: 'Number of times to repeat the action.',
        },
      },
      required: ['action', 'tabId'],
    },
  },
  {
    name: 'javascript_tool',
    description:
      'Execute JavaScript code in a browser tab and return the result. Use console.log for debugging and check results with read_console_messages.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['execute'],
          description: 'The action to perform. Currently only "execute" is supported.',
        },
        text: {
          type: 'string',
          description: 'The JavaScript code to execute.',
        },
        tabId: {
          type: 'number',
          description: 'The ID of the tab to execute in.',
        },
      },
      required: ['action', 'text', 'tabId'],
    },
  },
  {
    name: 'resize_window',
    description:
      'Resize the browser window to specific dimensions. Useful for testing responsive layouts.',
    inputSchema: {
      type: 'object',
      properties: {
        width: {
          type: 'number',
          description: 'The target width in pixels.',
        },
        height: {
          type: 'number',
          description: 'The target height in pixels.',
        },
        tabId: {
          type: 'number',
          description: 'The ID of the tab whose window to resize.',
        },
      },
      required: ['width', 'height', 'tabId'],
    },
  },
  {
    name: 'gif_creator',
    description:
      'Record browser interactions as GIF animations. Start recording, capture frames during actions, then save the GIF.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'capture', 'save', 'cancel'],
          description:
            'The GIF recording action: "start" to begin, "capture" to add a frame, "save" to finalize, "cancel" to discard.',
        },
        tabId: {
          type: 'number',
          description: 'The ID of the tab to record.',
        },
        filename: {
          type: 'string',
          description:
            'File name for the saved GIF (for "save" action). Should be descriptive.',
        },
        download: {
          type: 'boolean',
          description:
            'If true, download the GIF to the user\'s downloads folder.',
        },
        options: {
          type: 'object',
          properties: {
            quality: { type: 'number' },
            fps: { type: 'number' },
          },
          description: 'Recording quality options.',
        },
      },
      required: ['action', 'tabId'],
    },
  },
  {
    name: 'upload_image',
    description:
      'Upload an image to a file input element on the page.',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: {
          type: 'string',
          description: 'The ID of the image to upload (from a previous screenshot or capture).',
        },
        tabId: {
          type: 'number',
          description: 'The ID of the tab containing the file input.',
        },
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] coordinate of the file input element.',
        },
        ref: {
          type: 'string',
          description: 'Reference ID of the file input element.',
        },
        filename: {
          type: 'string',
          description: 'Optional filename for the uploaded image.',
        },
      },
      required: ['imageId', 'tabId'],
    },
  },
  {
    name: 'update_plan',
    description:
      'Update the automation plan with new domains or approach information.',
    inputSchema: {
      type: 'object',
      properties: {
        domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of domains involved in the automation.',
        },
        approach: {
          type: 'string',
          description: 'Description of the automation approach.',
        },
      },
      required: ['domains', 'approach'],
    },
  },
  {
    name: 'read_console_messages',
    description:
      'Read browser console messages (logs, warnings, errors). Use the pattern parameter to filter for specific entries.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'The ID of the tab to read console messages from.',
        },
        pattern: {
          type: 'string',
          description:
            'Regex-compatible pattern to filter console messages. Filters server-side for efficiency.',
        },
        onlyErrors: {
          type: 'boolean',
          description: 'If true, only return error-level messages.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return.',
        },
        clear: {
          type: 'boolean',
          description: 'If true, clear the console buffer after reading.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'read_network_requests',
    description:
      'Read captured network requests. Useful for debugging API calls and monitoring traffic.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'The ID of the tab to read network requests from.',
        },
        urlPattern: {
          type: 'string',
          description: 'Pattern to filter requests by URL.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of requests to return.',
        },
        clear: {
          type: 'boolean',
          description: 'If true, clear the request buffer after reading.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'shortcuts_list',
    description:
      'List available keyboard shortcuts for the current page or extension.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'The ID of the tab to list shortcuts for.',
        },
      },
      required: ['tabId'],
    },
  },
  {
    name: 'shortcuts_execute',
    description:
      'Execute a named keyboard shortcut on the page.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'The ID of the tab to execute the shortcut in.',
        },
        shortcutId: {
          type: 'string',
          description: 'The ID of the shortcut to execute (from shortcuts_list).',
        },
        command: {
          type: 'string',
          description: 'Alternative: a command string to execute.',
        },
      },
      required: ['tabId', 'shortcutId'],
    },
  },
]
