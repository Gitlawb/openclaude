import { feature } from 'bun:bundle'
import type { BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { SpinnerMode } from '../../components/Spinner.js'
import { isConnectorTextBlock } from '../../types/connectorText.js'
import type {
  Message,
  RequestStartEvent,
  StreamEvent,
  TombstoneMessage,
  ToolUseSummaryMessage,
} from '../../types/message.js'

export type StreamingToolUse = {
  index: number
  contentBlock: BetaToolUseBlock
  unparsedToolInput: string
}

export type StreamingThinking = {
  thinking: string
  isStreaming: boolean
  streamingEndedAt?: number
}

/**
 * Handles messages from a stream, updating response length for deltas and appending completed messages
 */
export function handleMessageFromStream(
  message:
    | Message
    | TombstoneMessage
    | StreamEvent
    | RequestStartEvent
    | ToolUseSummaryMessage,
  onMessage: (message: Message) => void,
  onUpdateLength: (newContent: string) => void,
  onSetStreamMode: (mode: SpinnerMode) => void,
  onStreamingToolUses: (
    f: (streamingToolUse: StreamingToolUse[]) => StreamingToolUse[],
  ) => void,
  onTombstone?: (message: Message) => void,
  onStreamingThinking?: (
    f: (current: StreamingThinking | null) => StreamingThinking | null,
  ) => void,
  onApiMetrics?: (metrics: { ttftMs: number }) => void,
  onStreamingText?: (f: (current: string | null) => string | null) => void,
): void {
  if (
    message.type !== 'stream_event' &&
    message.type !== 'stream_request_start'
  ) {
    // Handle tombstone messages - remove the targeted message instead of adding
    if (message.type === 'tombstone') {
      onTombstone?.(message.message)
      return
    }
    // Tool use summary messages are SDK-only, ignore them in stream handling
    if (message.type === 'tool_use_summary') {
      return
    }
    // Capture complete thinking blocks for real-time display in transcript mode
    if (message.type === 'assistant') {
      const thinkingBlock = message.message.content.find(
        block => block.type === 'thinking',
      )
      if (thinkingBlock && thinkingBlock.type === 'thinking') {
        onStreamingThinking?.(() => ({
          thinking: thinkingBlock.thinking,
          isStreaming: false,
          streamingEndedAt: Date.now(),
        }))
      }
    }
    // Clear streaming text NOW so the render can switch displayedMessages
    // from deferredMessages to messages in the same batch, making the
    // transition from streaming text → final message atomic (no gap, no duplication).
    onStreamingText?.(() => null)
    onMessage(message)
    return
  }

  if (message.type === 'stream_request_start') {
    onSetStreamMode('requesting')
    return
  }

  if (message.event.type === 'message_start') {
    if (message.ttftMs != null) {
      onApiMetrics?.({ ttftMs: message.ttftMs })
    }
  }

  if (message.event.type === 'message_stop') {
    onSetStreamMode('tool-use')
    onStreamingToolUses(() => [])
    return
  }

  switch (message.event.type) {
    case 'content_block_start':
      onStreamingText?.(() => null)
      if (
        feature('CONNECTOR_TEXT') &&
        isConnectorTextBlock(message.event.content_block)
      ) {
        onSetStreamMode('responding')
        return
      }
      switch (message.event.content_block.type) {
        case 'thinking':
        case 'redacted_thinking':
          onSetStreamMode('thinking')
          return
        case 'text':
          onSetStreamMode('responding')
          return
        case 'tool_use': {
          onSetStreamMode('tool-input')
          const contentBlock = message.event.content_block
          const index = message.event.index
          onStreamingToolUses(_ => [
            ..._,
            {
              index,
              contentBlock,
              unparsedToolInput: '',
            },
          ])
          return
        }
        case 'server_tool_use':
        case 'web_search_tool_result':
        case 'code_execution_tool_result':
        case 'mcp_tool_use':
        case 'mcp_tool_result':
        case 'container_upload':
        case 'web_fetch_tool_result':
        case 'bash_code_execution_tool_result':
        case 'text_editor_code_execution_tool_result':
        case 'tool_search_tool_result':
        case 'compaction':
          onSetStreamMode('tool-input')
          return
      }
      return
    case 'content_block_delta':
      switch (message.event.delta.type) {
        case 'text_delta': {
          const deltaText = message.event.delta.text
          onUpdateLength(deltaText)
          onStreamingText?.(text => (text ?? '') + deltaText)
          return
        }
        case 'input_json_delta': {
          const delta = message.event.delta.partial_json
          const index = message.event.index
          onUpdateLength(delta)
          onStreamingToolUses(_ => {
            // Update in place (preserve array order). The previous
            // filter-then-append moved the updated tool to the end, which
            // shuffled concurrently-streaming tools and broke the index-aligned
            // contentBlock check in the Messages memo comparator.
            let found = false
            const next = _.map(element => {
              if (element.index !== index) {
                return element
              }
              found = true
              return {
                ...element,
                unparsedToolInput: element.unparsedToolInput + delta,
              }
            })
            return found ? next : _
          })
          return
        }
        case 'thinking_delta':
          onUpdateLength(message.event.delta.thinking)
          return
        case 'signature_delta':
          // Signatures are cryptographic authentication strings, not model
          // output. Excluding them from onUpdateLength prevents them from
          // inflating the OTPS metric and the animated token counter.
          return
        default:
          return
      }
    case 'content_block_stop':
      return
    case 'message_delta':
      onSetStreamMode('responding')
      return
    default:
      onSetStreamMode('responding')
      return
  }
}
