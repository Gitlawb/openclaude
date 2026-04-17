/**
 * messageParser — transforms raw SDK messages from the CLI into view-model
 * objects that the chat renderer can display.
 */

const {
  isAssistantMessage,
  isPartialMessage,
  isResultMessage,
  isControlRequest,
  isStatusMessage,
  isToolProgressMessage,
  isSessionStateChanged,
  isRateLimitEvent,
  getTextContent,
  getToolUseBlocks,
} = require('./protocol');

function parseToolInput(input) {
  if (!input || typeof input !== 'object') return String(input ?? '');
  if (input.command) return input.command;
  if (input.file_path || input.path) return input.file_path || input.path;
  if (input.query) return input.query;
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}

function toolDisplayName(name) {
  const map = {
    Bash: 'Terminal',
    Read: 'Read File',
    Write: 'Write File',
    Edit: 'Edit File',
    MultiEdit: 'Multi Edit',
    Glob: 'Find Files',
    Grep: 'Search',
    LS: 'List Directory',
    WebFetch: 'Web Fetch',
    WebSearch: 'Web Search',
    TodoRead: 'Read Todos',
    TodoWrite: 'Write Todos',
    Task: 'Sub-agent',
  };
  return map[name] || name || 'Tool';
}

function toolIcon(name) {
  const map = {
    Bash: '\u{1F4BB}',
    Read: '\u{1F4C4}',
    Write: '\u{270F}\uFE0F',
    Edit: '\u{270F}\uFE0F',
    MultiEdit: '\u{270F}\uFE0F',
    Glob: '\u{1F50D}',
    Grep: '\u{1F50E}',
    LS: '\u{1F4C2}',
    WebFetch: '\u{1F310}',
    WebSearch: '\u{1F310}',
    Task: '\u{1F916}',
  };
  return map[name] || '\u{1F527}';
}

/**
 * Converts an SDK message into one or more view-model entries for the chat UI.
 * Returns an array so partial messages can update in-place while final messages
 * produce a finalized entry.
 */
function toViewModel(msg) {
  if (isAssistantMessage(msg)) {
    return [{
      kind: 'assistant',
      id: msg.id || msg.message?.id || null,
      text: getTextContent(msg.message || msg),
      toolUses: getToolUseBlocks(msg.message || msg).map(tu => ({
        id: tu.id,
        name: tu.name,
        displayName: toolDisplayName(tu.name),
        icon: toolIcon(tu.name),
        inputPreview: parseToolInput(tu.input),
        input: tu.input,
        status: 'complete',
      })),
      model: msg.model || null,
      stopReason: msg.stop_reason || null,
      usage: msg.usage || null,
      final: true,
    }];
  }

  if (isPartialMessage(msg)) {
    const inner = msg.message || msg;
    return [{
      kind: 'assistant_partial',
      id: inner.id || null,
      text: getTextContent(inner),
      toolUses: getToolUseBlocks(inner).map(tu => ({
        id: tu.id,
        name: tu.name,
        displayName: toolDisplayName(tu.name),
        icon: toolIcon(tu.name),
        inputPreview: parseToolInput(tu.input),
        input: tu.input,
        status: 'running',
      })),
      final: false,
    }];
  }

  if (isResultMessage(msg)) {
    return [{
      kind: 'tool_result',
      toolUseId: msg.tool_use_id,
      content: typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map(b => b.text || '').join('')
          : '',
      isError: msg.is_error || false,
    }];
  }

  if (isControlRequest(msg)) {
    return [{
      kind: 'permission_request',
      requestId: msg.request_id || msg.id,
      toolName: msg.tool_name || msg.tool?.name || 'Unknown',
      displayName: toolDisplayName(msg.tool_name || msg.tool?.name),
      description: msg.description || msg.tool?.description || '',
      input: msg.tool_input || msg.input || null,
      inputPreview: parseToolInput(msg.tool_input || msg.input),
    }];
  }

  if (isToolProgressMessage(msg)) {
    return [{
      kind: 'tool_progress',
      toolUseId: msg.tool_use_id,
      content: msg.content || msg.progress || '',
    }];
  }

  if (isStatusMessage(msg)) {
    return [{
      kind: 'status',
      content: msg.content || msg.message || '',
    }];
  }

  if (isSessionStateChanged(msg)) {
    return [{
      kind: 'session_state',
      sessionId: msg.session_id || null,
      state: msg.state || null,
    }];
  }

  if (isRateLimitEvent(msg)) {
    return [{
      kind: 'rate_limit',
      retryAfter: msg.retry_after || null,
      message: msg.message || 'Rate limited',
    }];
  }

  return [{
    kind: 'unknown',
    type: msg.type,
    raw: msg,
  }];
}

module.exports = {
  toViewModel,
  toolDisplayName,
  toolIcon,
  parseToolInput,
};
