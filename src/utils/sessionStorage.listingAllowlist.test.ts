import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { Message } from '../types/message.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { isLoggableMessage } from './sessionStorage.ts'

const originalUserType = process.env.USER_TYPE
const originalHookSave = process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT

beforeEach(async () => {
  await acquireSharedMutationLock('sessionStorage.listingAllowlist')
})

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
  releaseSharedMutationLock()
})

function attachment(type: string, extra: Record<string, unknown> = {}): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000b001',
    attachment: { type, ...extra },
  } as unknown as Message
}

test('isLoggableMessage filters prefix-cache listing deltas for external users (privacy boundary)', () => {
  process.env.USER_TYPE = 'external'

  // P1-1: these listing deltas carry sensitive payloads (skill descriptions,
  // custom agent whenToUse/tool policy, server-provided MCP instructions).
  // They must NOT be persisted to the external transcript / remote ingress.
  // Prefix-cache resume stability uses a separate local resume-cache that
  // stores the full listing payloads on disk only (never via isLoggableMessage).
  expect(
    isLoggableMessage(
      attachment('skill_listing', {
        content: 'skills',
        skillCount: 1,
        isInitial: true,
      }),
    ),
  ).toBe(false)
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
  ).toBe(false)
  expect(
    isLoggableMessage(
      attachment('deferred_tools_delta', {
        addedNames: ['ToolSearch'],
        addedLines: ['- ToolSearch'],
        removedNames: [],
      }),
    ),
  ).toBe(false)
  expect(
    isLoggableMessage(
      attachment('mcp_instructions_delta', {
        addedNames: ['demo'],
        addedBlocks: ['## demo\ndo things'],
        removedNames: [],
      }),
    ),
  ).toBe(false)
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
  // ant (first-party) sessions keep listing deltas in the transcript: the
  // privacy boundary only applies to external users.
  expect(
    isLoggableMessage(
      attachment('mcp_instructions_delta', {
        addedNames: ['demo'],
        addedBlocks: ['## demo\ndo things'],
        removedNames: [],
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
})
