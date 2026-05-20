import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'

export function isReactiveOnlyMode(): boolean {
  return false
}

export async function compactConversationReactively(
  messages: Message[],
  _context: ToolUseContext,
  _customInstructions?: string,
): Promise<any> {
  return {
    messages,
    syntheticUserMessage: null,
    displayText: '',
  }
}

export async function reactiveCompactOnPromptTooLong(
  messages: Message[],
  _cacheParams: unknown,
  _options?: unknown,
): Promise<any> {
  return {
    ok: false,
    reason: 'too_few_groups',
    result: {
      messages,
      userDisplayMessage: undefined,
    },
  }
}
