/**
 * NDJSON protocol helpers and message type constants for the OpenClaude
 * stream-json SDK wire format.
 *
 * The extension spawns `openclaude --print --input-format=stream-json
 * --output-format=stream-json` and speaks NDJSON over stdin/stdout.
 * This module provides lightweight parsing, serialization, and type guards
 * so the rest of the extension never touches raw JSON strings.
 */

const MESSAGE_TYPES = {
  ASSISTANT: 'assistant',
  USER: 'user',
  USER_REPLAY: 'user_replay',
  RESULT: 'result',
  SYSTEM: 'system',
  STREAM_EVENT: 'stream_event',
  PARTIAL: 'partial',
  COMPACT_BOUNDARY: 'compact_boundary',
  STATUS: 'status',
  API_RETRY: 'api_retry',
  LOCAL_COMMAND_OUTPUT: 'local_command_output',
  HOOK_STARTED: 'hook_started',
  HOOK_PROGRESS: 'hook_progress',
  HOOK_RESPONSE: 'hook_response',
  TOOL_PROGRESS: 'tool_progress',
  AUTH_STATUS: 'auth_status',
  TASK_NOTIFICATION: 'task_notification',
  TASK_STARTED: 'task_started',
  TASK_PROGRESS: 'task_progress',
  SESSION_STATE_CHANGED: 'session_state_changed',
  FILES_PERSISTED: 'files_persisted',
  TOOL_USE_SUMMARY: 'tool_use_summary',
  RATE_LIMIT: 'rate_limit',
  ELICITATION_COMPLETE: 'elicitation_complete',
  PROMPT_SUGGESTION: 'prompt_suggestion',
  STREAMLINED_TEXT: 'streamlined_text',
  STREAMLINED_TOOL_USE_SUMMARY: 'streamlined_tool_use_summary',
  POST_TURN_SUMMARY: 'post_turn_summary',
  CONTROL_RESPONSE: 'control_response',
  CONTROL_REQUEST: 'control_request',
};

function parseStdoutLine(line) {
  const trimmed = (line || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function serializeStdinMessage(msg) {
  return JSON.stringify(msg) + '\n';
}

function buildUserMessage(text) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: text,
    },
    parent_tool_use_id: null,
  };
}

function buildControlResponse(requestId, result) {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: result || {},
    },
  };
}

function isAssistantMessage(msg) {
  return msg && msg.type === MESSAGE_TYPES.ASSISTANT;
}

function isPartialMessage(msg) {
  return msg && msg.type === MESSAGE_TYPES.PARTIAL;
}

function isStreamEvent(msg) {
  return msg && msg.type === MESSAGE_TYPES.STREAM_EVENT && msg.event;
}

function isContentBlockDelta(msg) {
  return isStreamEvent(msg) && msg.event.type === 'content_block_delta';
}

function isContentBlockStart(msg) {
  return isStreamEvent(msg) && msg.event.type === 'content_block_start';
}

function isMessageStart(msg) {
  return isStreamEvent(msg) && msg.event.type === 'message_start';
}

function isMessageStop(msg) {
  return isStreamEvent(msg) && msg.event.type === 'message_stop';
}

function isMessageDelta(msg) {
  return isStreamEvent(msg) && msg.event.type === 'message_delta';
}

function isResultMessage(msg) {
  return msg && msg.type === MESSAGE_TYPES.RESULT;
}

function isToolUse(block) {
  return block && block.type === 'tool_use';
}

function isTextBlock(block) {
  return block && block.type === 'text';
}

function isThinkingBlock(block) {
  return block && block.type === 'thinking';
}

function isControlRequest(msg) {
  return msg && msg.type === MESSAGE_TYPES.CONTROL_REQUEST;
}

function isStatusMessage(msg) {
  return msg && msg.type === MESSAGE_TYPES.STATUS;
}

function isToolProgressMessage(msg) {
  return msg && msg.type === MESSAGE_TYPES.TOOL_PROGRESS;
}

function isSessionStateChanged(msg) {
  return msg && msg.type === MESSAGE_TYPES.SESSION_STATE_CHANGED;
}

function isRateLimitEvent(msg) {
  return msg && msg.type === MESSAGE_TYPES.RATE_LIMIT;
}

function getTextContent(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join('');
}

function getToolUseBlocks(message) {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content.filter(b => b.type === 'tool_use');
}

module.exports = {
  MESSAGE_TYPES,
  parseStdoutLine,
  serializeStdinMessage,
  buildUserMessage,
  buildControlResponse,
  isAssistantMessage,
  isPartialMessage,
  isStreamEvent,
  isContentBlockDelta,
  isContentBlockStart,
  isMessageStart,
  isMessageStop,
  isMessageDelta,
  isResultMessage,
  isToolUse,
  isTextBlock,
  isThinkingBlock,
  isControlRequest,
  isStatusMessage,
  isToolProgressMessage,
  isSessionStateChanged,
  isRateLimitEvent,
  getTextContent,
  getToolUseBlocks,
};
