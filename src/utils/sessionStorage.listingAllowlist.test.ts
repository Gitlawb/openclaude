import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Message } from '../types/message.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { normalizeMessagesForAPI } from './messages.js'
import {
  filterJsonlForExternalEgress,
  filterMessagesForExternalEgress,
  isLoggableMessage,
  isPrefixCacheListingAttachment,
  isSafeForExternalEgress,
  loadTranscriptFile,
} from './sessionStorage.ts'

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

const LISTING_CASES: Array<{ type: string; extra: Record<string, unknown> }> = [
  {
    type: 'skill_listing',
    extra: { content: 'skills', skillCount: 1, isInitial: true },
  },
  {
    type: 'agent_listing_delta',
    extra: {
      addedTypes: ['Explore'],
      addedLines: ['- Explore: stub'],
      removedTypes: [],
      isInitial: true,
      showConcurrencyNote: true,
    },
  },
  {
    type: 'deferred_tools_delta',
    extra: {
      addedNames: ['ToolSearch'],
      addedLines: ['- ToolSearch'],
      removedNames: [],
    },
  },
  {
    type: 'mcp_instructions_delta',
    extra: {
      addedNames: ['demo'],
      addedBlocks: ['## demo\ndo things'],
      removedNames: [],
    },
  },
]

test('isLoggableMessage retains prefix-cache listing deltas for external users (local transcript)', () => {
  process.env.USER_TYPE = 'external'

  // Option A: local JSONL is the single authoritative history. Listing
  // attachments keep their original positions for --resume prefix cache.
  // Privacy filtering happens only at remote/public egress.
  for (const c of LISTING_CASES) {
    expect(isLoggableMessage(attachment(c.type, c.extra))).toBe(true)
  }
})

test('isSafeForExternalEgress strips prefix-cache listing deltas for external users', () => {
  process.env.USER_TYPE = 'external'

  for (const c of LISTING_CASES) {
    expect(isSafeForExternalEgress(attachment(c.type, c.extra))).toBe(false)
  }
  // Non-attachment transcript entries still egress.
  expect(
    isSafeForExternalEgress({
      type: 'user',
      message: { role: 'user', content: 'hi' },
    }),
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
  expect(
    isSafeForExternalEgress(
      attachment('file', { filename: '/tmp/secret.txt', content: 'nope' }),
    ),
  ).toBe(false)
})

test('isLoggableMessage keeps hook_additional_context behind its env gate', () => {
  process.env.USER_TYPE = 'external'
  process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'

  const hook = attachment('hook_additional_context', {
    content: ['hook output'],
    hookName: 'SessionStart',
    toolName: undefined,
    toolUseID: undefined,
    hookEvent: 'SessionStart',
  })
  expect(isLoggableMessage(hook)).toBe(true)
  expect(isSafeForExternalEgress(hook)).toBe(true)
})

test('isLoggableMessage allows all attachments for ant users', () => {
  process.env.USER_TYPE = 'ant'

  expect(
    isLoggableMessage(
      attachment('file', { filename: '/tmp/x.txt', content: 'x' }),
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
  expect(
    isSafeForExternalEgress(
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

test('isLoggableMessage fails closed on malformed null attachment for external users', () => {
  process.env.USER_TYPE = 'external'
  const malformed = {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000bad2',
    attachment: null,
  } as unknown as Message

  expect(() => isLoggableMessage(malformed)).not.toThrow()
  expect(isLoggableMessage(malformed)).toBe(false)
  expect(isSafeForExternalEgress(malformed)).toBe(false)
})

test('isLoggableMessage fails closed on non-object attachment payload', () => {
  process.env.USER_TYPE = 'external'
  const malformed = {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000bad3',
    attachment: 'skill_listing',
  } as unknown as Message

  expect(() => isLoggableMessage(malformed)).not.toThrow()
  expect(isLoggableMessage(malformed)).toBe(false)
  expect(isSafeForExternalEgress(malformed)).toBe(false)
})

test('local retain vs egress strip matrix for all prefix-cache listing types', () => {
  process.env.USER_TYPE = 'external'

  for (const c of LISTING_CASES) {
    const msg = attachment(c.type, c.extra)
    expect(isPrefixCacheListingAttachment(msg)).toBe(true)
    expect(isLoggableMessage(msg)).toBe(true)
    expect(isSafeForExternalEgress(msg)).toBe(false)
  }
})

test('filterMessagesForExternalEgress keeps conversation turns and drops listings', () => {
  process.env.USER_TYPE = 'external'

  const user = {
    type: 'user',
    uuid: '00000000-0000-4000-8000-00000000u001',
    message: { role: 'user', content: 'hello' },
  } as unknown as Message
  const listing = attachment('skill_listing', {
    content: 'Available skills:\n- /demo',
    skillCount: 1,
    isInitial: true,
  })
  const assistant = {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-00000000a001',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
    },
  } as unknown as Message

  const filtered = filterMessagesForExternalEgress([user, listing, assistant])
  expect(filtered).toHaveLength(2)
  expect(filtered[0]).toBe(user)
  expect(filtered[1]).toBe(assistant)
})

test('filterJsonlForExternalEgress strips listing lines but keeps neighbors', () => {
  process.env.USER_TYPE = 'external'

  const userLine = JSON.stringify({
    type: 'user',
    uuid: '00000000-0000-4000-8000-00000000u002',
    message: { role: 'user', content: 'hi' },
  })
  const listingLine = JSON.stringify({
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000l002',
    attachment: {
      type: 'mcp_instructions_delta',
      addedNames: ['demo'],
      addedBlocks: ['## demo\nsecret catalog'],
      removedNames: [],
    },
  })
  const assistantLine = JSON.stringify({
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-00000000a002',
    message: { role: 'assistant', content: [{ type: 'text', text: 'yo' }] },
  })
  const raw = [userLine, listingLine, assistantLine, ''].join('\n')
  const filtered = filterJsonlForExternalEgress(raw)
  expect(filtered).toBe([userLine, assistantLine, ''].join('\n'))
  expect(filtered).not.toContain('secret catalog')
  expect(filtered).not.toContain('mcp_instructions_delta')
})

test('normalizeMessagesForAPI after egress filter does not bake skill catalog into user text', () => {
  process.env.USER_TYPE = 'external'

  const listing = attachment('skill_listing', {
    content: 'Available skills:\n- /leak-me-please',
    skillCount: 1,
    isInitial: true,
  })
  const user = {
    type: 'user',
    uuid: '00000000-0000-4000-8000-00000000u003',
    message: { role: 'user', content: 'plain turn' },
  } as unknown as Message

  // Share/feedback historically called normalizeMessagesForAPI(messages)
  // directly; skill_listing becomes user text with the full catalog. Option A
  // requires filtering first.
  const withoutFilter = normalizeMessagesForAPI([listing, user])
  const baked = JSON.stringify(withoutFilter)
  expect(baked).toContain('leak-me-please')

  const withFilter = normalizeMessagesForAPI(
    filterMessagesForExternalEgress([listing, user]),
  )
  const safe = JSON.stringify(withFilter)
  expect(safe).not.toContain('leak-me-please')
  expect(safe).toContain('plain turn')
})

test('loadTranscriptFile reloads local JSONL byte-stable through the last pre-resume message', async () => {
  process.env.USER_TYPE = 'external'

  const sessionId = '00000000-0000-4000-8000-00000000c000'
  const ts = '2026-08-01T00:00:00.000Z'
  const base = (uuid: string, parentUuid: string | null) => ({
    uuid,
    parentUuid,
    timestamp: ts,
    cwd: '/tmp',
    userType: 'external',
    sessionId,
    version: 'test',
    isSidechain: false,
  })

  const chain = [
    {
      ...base('00000000-0000-4000-8000-00000000c001', null),
      type: 'user',
      isMeta: false,
      message: { role: 'user', content: 'turn one' },
    },
    {
      ...base(
        '00000000-0000-4000-8000-00000000c002',
        '00000000-0000-4000-8000-00000000c001',
      ),
      type: 'attachment',
      attachment: {
        type: 'skill_listing',
        content: 'Available skills:\n- /demo',
        skillCount: 1,
        isInitial: true,
      },
    },
    {
      ...base(
        '00000000-0000-4000-8000-00000000c003',
        '00000000-0000-4000-8000-00000000c002',
      ),
      type: 'attachment',
      attachment: {
        type: 'mcp_instructions_delta',
        addedNames: ['demo'],
        addedBlocks: ['## demo\ninstructions'],
        removedNames: [],
      },
    },
    {
      ...base(
        '00000000-0000-4000-8000-00000000c004',
        '00000000-0000-4000-8000-00000000c003',
      ),
      type: 'assistant',
      message: {
        id: '00000000-0000-4000-8000-00000000c004',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'reply one' }],
        model: 'test-model',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
    {
      ...base(
        '00000000-0000-4000-8000-00000000c005',
        '00000000-0000-4000-8000-00000000c004',
      ),
      type: 'user',
      isMeta: false,
      message: { role: 'user', content: 'last pre-resume turn' },
    },
  ]

  const dir = await mkdtemp(join(tmpdir(), 'listing-roundtrip-'))
  const file = join(dir, 'session.jsonl')
  const raw = `${chain.map(e => JSON.stringify(e)).join('\n')}\n`
  try {
    await writeFile(file, raw, 'utf-8')
    const { messages } = await loadTranscriptFile(file)

    const ordered: Array<(typeof chain)[number]> = []
    let cursor: string | null = '00000000-0000-4000-8000-00000000c005'
    while (cursor) {
      const entry = messages.get(cursor as never)
      if (!entry) break
      ordered.unshift(entry as unknown as (typeof chain)[number])
      cursor = (entry as { parentUuid: string | null }).parentUuid
    }

    expect(ordered.map(e => e.uuid)).toEqual(chain.map(e => e.uuid))
    expect(ordered.map(e => e.type)).toEqual(chain.map(e => e.type))
    expect(JSON.stringify(ordered[1]?.attachment)).toBe(
      JSON.stringify(chain[1]?.attachment),
    )
    expect(JSON.stringify(ordered[2]?.attachment)).toBe(
      JSON.stringify(chain[2]?.attachment),
    )
    expect(
      (ordered[1] as { attachment: { content: string } }).attachment.content,
    ).toBe('Available skills:\n- /demo')
    expect(
      (ordered[2] as { attachment: { addedBlocks: string[] } }).attachment
        .addedBlocks,
    ).toEqual(['## demo\ninstructions'])

    const egress = filterJsonlForExternalEgress(raw)
    expect(egress).not.toContain('skill_listing')
    expect(egress).not.toContain('mcp_instructions_delta')
    expect(egress).toContain('turn one')
    expect(egress).toContain('last pre-resume turn')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
