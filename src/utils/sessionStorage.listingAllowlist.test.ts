import { afterEach, expect, test } from 'bun:test'
import type { Message } from '../types/message.js'
import { isLoggableMessage } from './sessionStorage.ts'

const originalUserType = process.env.USER_TYPE
const originalHookSave = process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT

afterEach(() => {
  if (originalUserType === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = originalUserType
  }
  if (originalHookSave === undefined) {
    delete process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT
  } else {
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = originalHookSave
  }
})

function attachment(type: string, extra: Record<string, unknown> = {}): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000b001',
    attachment: { type, ...extra },
  } as unknown as Message
}

test('isLoggableMessage persists prefix-cache listing deltas for external users', () => {
  process.env.USER_TYPE = 'external'

  expect(
    isLoggableMessage(
      attachment('skill_listing', {
        content: 'skills',
        skillCount: 1,
        isInitial: true,
      }),
    ),
  ).toBe(true)
  expect(
    isLoggableMessage(
      attachment('agent_listing_delta', {
        addedTypes: ['Explore'],
        addedLines: ['- Explore: stub'],
        removedTypes: [],
        isInitial: true,
        showConcurrencyNote: true,
      }),
    ),
  ).toBe(true)
  expect(
    isLoggableMessage(
      attachment('deferred_tools_delta', {
        addedNames: ['ToolSearch'],
        addedLines: ['- ToolSearch'],
        removedNames: [],
      }),
    ),
  ).toBe(true)
  expect(
    isLoggableMessage(
      attachment('mcp_instructions_delta', {
        addedNames: ['demo'],
        addedBlocks: ['## demo\ndo things'],
        removedNames: [],
      }),
    ),
  ).toBe(true)
})

test('isLoggableMessage still filters unrelated attachments for external users', () => {
  process.env.USER_TYPE = 'external'
  delete process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT

  expect(
    isLoggableMessage(
      attachment('file', { filename: '/tmp/secret.txt', content: 'nope' }),
    ),
  ).toBe(false)
  expect(
    isLoggableMessage(
      attachment('hook_additional_context', {
        content: ['hook output'],
        hookName: 'SessionStart',
        toolName: undefined,
        toolUseID: undefined,
        hookEvent: 'SessionStart',
      }),
    ),
  ).toBe(false)
})

test('isLoggableMessage keeps hook_additional_context behind its env gate', () => {
  process.env.USER_TYPE = 'external'
  process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'

  expect(
    isLoggableMessage(
      attachment('hook_additional_context', {
        content: ['hook output'],
        hookName: 'SessionStart',
        toolName: undefined,
        toolUseID: undefined,
        hookEvent: 'SessionStart',
      }),
    ),
  ).toBe(true)
})

test('isLoggableMessage allows all attachments for ant users', () => {
  process.env.USER_TYPE = 'ant'

  expect(
    isLoggableMessage(
      attachment('file', { filename: '/tmp/x.txt', content: 'x' }),
    ),
  ).toBe(true)
})
