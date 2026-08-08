import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { UUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  setSessionPersistenceDisabled,
  switchSession,
} from '../bootstrap/state.js'
import type { TranscriptMessage } from '../types/logs.js'
import type { Message } from '../types/message.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { normalizeMessagesForAPI } from './messages.js'
import {
  adoptResumedSessionFile,
  buildConversationChain,
  clearSessionMessagesCache,
  filterJsonlForExternalEgress,
  filterMessagesForExternalEgress,
  filterSubagentTranscriptsForExternalEgress,
  flushSessionStorage,
  isLoggableMessage,
  isPrefixCacheListingAttachment,
  isSafeForExternalEgress,
  loadTranscriptFile,
  projectTranscriptParentForExternalEgress,
  rebuildRemoteEgressOmittedParentsForTesting,
  recordExternalEgressOmission,
  recordTranscript,
  resetProjectForTesting,
  resetSessionFilePointer,
  setInternalEventWriter,
  setSessionFileForTesting,
} from './sessionStorage.ts'

function asUuid(value: string): UUID {
  return value as unknown as UUID
}

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
    } as { type?: string; attachment?: unknown }),
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
  // Local retain still applies for ant; egress must still strip listings.
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
  ).toBe(false)
})

test('isSafeForExternalEgress strips listing attachments before ant fast path', () => {
  process.env.USER_TYPE = 'ant'

  for (const c of LISTING_CASES) {
    const msg = attachment(c.type, c.extra)
    expect(isPrefixCacheListingAttachment(msg)).toBe(true)
    expect(isLoggableMessage(msg)).toBe(true)
    expect(isSafeForExternalEgress(msg)).toBe(false)
  }

  const user = {
    type: 'user',
    uuid: '00000000-0000-4000-8000-00000000u0a1',
    message: { role: 'user', content: 'ant turn' },
  } as unknown as Message
  const listing = attachment('skill_listing', {
    content: 'Available skills:\n- /ant-secret',
    skillCount: 1,
    isInitial: true,
  })
  expect(filterMessagesForExternalEgress([user, listing])).toEqual([user])

  const userLine = JSON.stringify(user)
  const listingLine = JSON.stringify({
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000l0a1',
    attachment: listing.attachment,
  })
  const filtered = filterJsonlForExternalEgress(
    [userLine, listingLine, ''].join('\n'),
  )
  expect(filtered).toBe([userLine, ''].join('\n'))
  expect(filtered).not.toContain('ant-secret')
  expect(filtered).not.toContain('skill_listing')
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
    parentUuid: null,
    message: { role: 'user', content: 'hello' },
  } as unknown as Message
  const listing = {
    ...attachment('skill_listing', {
      content: 'Available skills:\n- /demo',
      skillCount: 1,
      isInitial: true,
    }),
    uuid: '00000000-0000-4000-8000-00000000l001',
    parentUuid: '00000000-0000-4000-8000-00000000u001',
  } as unknown as Message
  const assistant = {
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-00000000a001',
    parentUuid: '00000000-0000-4000-8000-00000000l001',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
    },
  } as unknown as Message

  const filtered = filterMessagesForExternalEgress([user, listing, assistant])
  expect(filtered).toHaveLength(2)
  expect(filtered[0]).toBe(user)
  expect(filtered[1]?.uuid).toBe(assistant.uuid)
  // Relink across the omitted listing so remote/share chains stay walkable.
  expect(filtered[1]?.parentUuid).toBe(user.uuid)
  expect(JSON.stringify(filtered)).not.toContain('/demo')
})

test('filterJsonlForExternalEgress strips listing lines but keeps neighbors', () => {
  process.env.USER_TYPE = 'external'

  const userLine = JSON.stringify({
    type: 'user',
    uuid: '00000000-0000-4000-8000-00000000u002',
    parentUuid: null,
    message: { role: 'user', content: 'hi' },
  })
  const listingLine = JSON.stringify({
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000l002',
    parentUuid: '00000000-0000-4000-8000-00000000u002',
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
    parentUuid: '00000000-0000-4000-8000-00000000l002',
    message: { role: 'assistant', content: [{ type: 'text', text: 'yo' }] },
  })
  const raw = [userLine, listingLine, assistantLine, ''].join('\n')
  const filtered = filterJsonlForExternalEgress(raw)
  expect(filtered).not.toContain('secret catalog')
  expect(filtered).not.toContain('mcp_instructions_delta')
  expect(filtered).toContain('00000000-0000-4000-8000-00000000u002')
  expect(filtered).toContain('00000000-0000-4000-8000-00000000a002')
  expect(filtered).not.toContain('00000000-0000-4000-8000-00000000l002')
  const assistantProjected = JSON.parse(
    filtered.split('\n').find(l => l.includes('00000000-0000-4000-8000-00000000a002'))!,
  )
  expect(assistantProjected.parentUuid).toBe(
    '00000000-0000-4000-8000-00000000u002',
  )
})

test('external egress projection preserves a walkable parentUuid chain without listing payloads', () => {
  process.env.USER_TYPE = 'external'

  type ChainMsg = {
    type: string
    uuid: UUID
    parentUuid: UUID | null
    attachment?: Record<string, unknown>
    message?: { role: string; content: string }
  }

  const userUuid = asUuid('00000000-0000-4000-8000-00000000r001')
  const listingUuid = asUuid('00000000-0000-4000-8000-00000000r002')
  const mcpUuid = asUuid('00000000-0000-4000-8000-00000000r003')
  const assistantUuid = asUuid('00000000-0000-4000-8000-00000000r004')
  const chain: ChainMsg[] = [
    {
      type: 'user',
      uuid: userUuid,
      parentUuid: null,
      message: { role: 'user', content: 'hi' },
    },
    {
      type: 'attachment',
      uuid: listingUuid,
      parentUuid: userUuid,
      attachment: {
        type: 'skill_listing',
        content: 'Available skills:\n- /private',
        skillCount: 1,
        isInitial: true,
      },
    },
    {
      type: 'attachment',
      uuid: mcpUuid,
      parentUuid: listingUuid,
      attachment: {
        type: 'mcp_instructions_delta',
        addedNames: ['demo'],
        addedBlocks: ['## demo\nsecret-mcp'],
        removedNames: [],
      },
    },
    {
      type: 'assistant',
      uuid: assistantUuid,
      parentUuid: mcpUuid,
      message: { role: 'assistant', content: 'ok' },
    },
  ]

  const projected = filterMessagesForExternalEgress(chain)
  expect(projected.map(m => m.uuid)).toEqual([userUuid, assistantUuid])
  expect(projected[1]?.parentUuid).toBe(userUuid)
  expect(JSON.stringify(projected)).not.toContain('/private')
  expect(JSON.stringify(projected)).not.toContain('secret-mcp')

  // Same contract as hydrateRemoteSession + buildConversationChain: a Map of
  // projected entries must walk from the leaf back to the root without
  // stopping on a missing listing UUID.
  const leaf = projected[1]
  expect(leaf?.uuid).toBeDefined()
  const byUuid = new Map<UUID, TranscriptMessage>(
    projected.map(m => [m.uuid, m as unknown as TranscriptMessage]),
  )
  const walked = buildConversationChain(
    byUuid,
    leaf as unknown as TranscriptMessage,
  )
  expect(walked.map(m => m.uuid)).toEqual([userUuid, assistantUuid])

  // Remote-resume contract: reparent keeps the chain, but does not restore
  // the model-visible listing prefix (cache miss / reconstruction).
  const omitted = new Map<UUID, UUID | null>()
  recordExternalEgressOmission(omitted, listingUuid, userUuid)
  recordExternalEgressOmission(omitted, mcpUuid, listingUuid)
  const reparented = projectTranscriptParentForExternalEgress(
    { parentUuid: mcpUuid },
    omitted,
  )
  expect(reparented.parentUuid).toBe(userUuid)
})

test('filterJsonlForExternalEgress drops unparseable non-empty lines fail-closed', () => {
  process.env.USER_TYPE = 'external'

  const userLine = JSON.stringify({
    type: 'user',
    uuid: '00000000-0000-4000-8000-00000000u00m',
    message: { role: 'user', content: 'keep me' },
  })
  // Corrupt / partial listing fragment — must not reach share or feedback.
  const malformedListing =
    '{"type":"attachment","attachment":{"type":"skill_listing","content":"Available skills:\\n- /leak-via-parse-error"'
  const assistantLine = JSON.stringify({
    type: 'assistant',
    uuid: '00000000-0000-4000-8000-00000000a00m',
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  })
  const filtered = filterJsonlForExternalEgress(
    [userLine, malformedListing, assistantLine, ''].join('\n'),
  )
  expect(filtered).toBe([userLine, assistantLine, ''].join('\n'))
  expect(filtered).not.toContain('leak-via-parse-error')
  expect(filtered).not.toContain('skill_listing')
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
      const entry = messages.get(asUuid(cursor))
      if (!entry) break
      ordered.unshift(entry as unknown as (typeof chain)[number])
      cursor = entry.parentUuid
    }

    expect(ordered.map(e => e.uuid)).toEqual(chain.map(e => e.uuid))
    expect(ordered.map(e => e.type)).toEqual(chain.map(e => e.type))
    // Byte-stability: every persisted field survives the reload unchanged.
    for (const [i, expected] of chain.entries()) {
      expect(ordered[i]).toMatchObject(expected)
    }
    expect(
      JSON.stringify(
        (ordered[1] as { attachment?: unknown } | undefined)?.attachment,
      ),
    ).toBe(
      JSON.stringify(
        (chain[1] as { attachment?: unknown } | undefined)?.attachment,
      ),
    )
    expect(
      JSON.stringify(
        (ordered[2] as { attachment?: unknown } | undefined)?.attachment,
      ),
    ).toBe(
      JSON.stringify(
        (chain[2] as { attachment?: unknown } | undefined)?.attachment,
      ),
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

/**
 * Remote-resume contract (jatmn review 4835237820):
 * - Local JSONL retains model-visible listing attachments (prefix-cache hit).
 * - Remote/CCR/share projection omits those listings and reparents survivors.
 * - hydrateRemoteSession writes that projection to disk; loadTranscriptFile +
 *   buildConversationChain must still walk early history (no truncation).
 * - Remote resume is an explicit listing-prefix cache miss — it must not claim
 *   byte-stable listing payloads across remote hydrate.
 */
test('remote-resume contract: omit-without-reparent truncates early history on hydrate path', async () => {
  process.env.USER_TYPE = 'external'

  const userUuid = '00000000-0000-4000-8000-00000000h001'
  const listingUuid = '00000000-0000-4000-8000-00000000h002'
  const assistantUuid = '00000000-0000-4000-8000-00000000h003'
  const sessionId = '00000000-0000-4000-8000-00000000h000'
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

  // Broken egress: drop listing rows but leave assistant.parentUuid → listing.
  // This is the failure mode jatmn described before reparenting.
  const brokenRemote = [
    {
      ...base(userUuid, null),
      type: 'user',
      isMeta: false,
      message: { role: 'user', content: 'early history turn' },
    },
    {
      ...base(assistantUuid, listingUuid),
      type: 'assistant',
      message: {
        id: assistantUuid,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
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
  ]

  const dir = await mkdtemp(join(tmpdir(), 'listing-hydrate-break-'))
  const file = join(dir, 'remote-broken.jsonl')
  try {
    await writeFile(
      file,
      `${brokenRemote.map(e => JSON.stringify(e)).join('\n')}\n`,
      'utf-8',
    )
    const { messages } = await loadTranscriptFile(file)
    const leaf = messages.get(asUuid(assistantUuid))
    expect(leaf).toBeDefined()
    const walked = buildConversationChain(messages, leaf!)
    // Walk stops at the dangling listing parent — early user is lost.
    expect(walked.map(m => m.uuid)).toEqual([assistantUuid])
    expect(walked.some(m => m.uuid === userUuid)).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('remote-resume contract: hydrate-equivalent reparented projection walks early history as listing cache miss', async () => {
  process.env.USER_TYPE = 'external'

  const sessionId = '00000000-0000-4000-8000-00000000k000'
  const ts = '2026-08-01T00:00:00.000Z'
  const userUuid = '00000000-0000-4000-8000-00000000k001'
  const listingUuid = '00000000-0000-4000-8000-00000000k002'
  const mcpUuid = '00000000-0000-4000-8000-00000000k003'
  const assistantUuid = '00000000-0000-4000-8000-00000000k004'
  const leafUuid = '00000000-0000-4000-8000-00000000k005'
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

  const localChain = [
    {
      ...base(userUuid, null),
      type: 'user',
      isMeta: false,
      message: { role: 'user', content: 'early history turn' },
    },
    {
      ...base(listingUuid, userUuid),
      type: 'attachment',
      attachment: {
        type: 'skill_listing',
        content: 'Available skills:\n- /private-prefix',
        skillCount: 1,
        isInitial: true,
      },
    },
    {
      ...base(mcpUuid, listingUuid),
      type: 'attachment',
      attachment: {
        type: 'mcp_instructions_delta',
        addedNames: ['demo'],
        addedBlocks: ['## demo\nsecret-mcp-prefix'],
        removedNames: [],
      },
    },
    {
      ...base(assistantUuid, mcpUuid),
      type: 'assistant',
      message: {
        id: assistantUuid,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'reply after listings' }],
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
      ...base(leafUuid, assistantUuid),
      type: 'user',
      isMeta: false,
      message: { role: 'user', content: 'post-resume turn' },
    },
  ]

  const dir = await mkdtemp(join(tmpdir(), 'listing-hydrate-contract-'))
  const localFile = join(dir, 'local.jsonl')
  const remoteFile = join(dir, 'remote-hydrated.jsonl')
  const localRaw = `${localChain.map(e => JSON.stringify(e)).join('\n')}\n`
  // hydrateRemoteSession writes remoteLogs as JSONL; filterJsonlForExternalEgress
  // is the batch projection of what remote/CCR receives after reparent.
  const remoteProjection = filterJsonlForExternalEgress(localRaw)
  try {
    await writeFile(localFile, localRaw, 'utf-8')
    await writeFile(remoteFile, remoteProjection, 'utf-8')

    // Local resume: listing prefix present (byte-stable / cache hit).
    const localLoaded = await loadTranscriptFile(localFile)
    const localLeaf = localLoaded.messages.get(asUuid(leafUuid))
    expect(localLeaf).toBeDefined()
    const localWalked = buildConversationChain(
      localLoaded.messages,
      localLeaf!,
    )
    expect(localWalked.map(m => m.uuid as string)).toEqual(
      localChain.map(e => e.uuid),
    )
    expect(
      localWalked.some(
        m =>
          m.type === 'attachment' &&
          (m as { attachment?: { type?: string } }).attachment?.type ===
            'skill_listing',
      ),
    ).toBe(true)
    expect(
      localWalked.some(
        m =>
          m.type === 'attachment' &&
          (m as { attachment?: { type?: string } }).attachment?.type ===
            'mcp_instructions_delta',
      ),
    ).toBe(true)

    // Remote hydrate path: same leaf, reparented chain, no listing payloads.
    expect(remoteProjection).not.toContain('skill_listing')
    expect(remoteProjection).not.toContain('mcp_instructions_delta')
    expect(remoteProjection).not.toContain('/private-prefix')
    expect(remoteProjection).not.toContain('secret-mcp-prefix')
    expect(remoteProjection).not.toContain(listingUuid)
    expect(remoteProjection).not.toContain(mcpUuid)
    expect(remoteProjection).toContain('early history turn')
    expect(remoteProjection).toContain('post-resume turn')

    const remoteLoaded = await loadTranscriptFile(remoteFile)
    expect(remoteLoaded.messages.has(asUuid(listingUuid))).toBe(false)
    expect(remoteLoaded.messages.has(asUuid(mcpUuid))).toBe(false)
    const remoteLeaf = remoteLoaded.messages.get(asUuid(leafUuid))
    expect(remoteLeaf).toBeDefined()
    const remoteWalked = buildConversationChain(
      remoteLoaded.messages,
      remoteLeaf!,
    )

    // Early history is not truncated; listing UUIDs are absent (cache miss).
    expect(remoteWalked.map(m => m.uuid)).toEqual([
      userUuid,
      assistantUuid,
      leafUuid,
    ])
    expect(remoteWalked[0]?.uuid).toBe(userUuid)
    expect(
      remoteWalked.some(
        m =>
          m.type === 'attachment' &&
          (m as { attachment?: { type?: string } }).attachment?.type ===
            'skill_listing',
      ),
    ).toBe(false)
    expect(
      remoteWalked.some(
        m =>
          m.type === 'attachment' &&
          (m as { attachment?: { type?: string } }).attachment?.type ===
            'mcp_instructions_delta',
      ),
    ).toBe(false)
    // Assistant was reparented past omitted listings onto the early user.
    expect(remoteWalked[1]?.parentUuid).toBe(userUuid)

    // Explicit contract: remote hydrate ≠ local byte-stable listing prefix.
    expect(remoteWalked.map(m => m.uuid)).not.toEqual(
      localWalked.map(m => m.uuid),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('filterSubagentTranscriptsForExternalEgress strips listings per agent', () => {
  process.env.USER_TYPE = 'external'
  const listing = attachment('skill_listing', {
    content: 'Available skills:\n- /leak-me-please',
    skillCount: 1,
    isInitial: true,
  })
  const user = {
    type: 'user',
    uuid: '00000000-0000-4000-8000-00000000u010',
    message: { role: 'user', content: 'subagent turn' },
  } as unknown as Message

  const filtered = filterSubagentTranscriptsForExternalEgress({
    a1: [listing, user],
  })
  expect(filtered.a1).toHaveLength(1)
  expect(filtered.a1![0]).toMatchObject({ type: 'user' })
  expect(JSON.stringify(filtered)).not.toContain('leak-me-please')
})

test('rebuildRemoteEgressOmittedParentsForTesting rebuilds omission ancestry from local JSONL', async () => {
  process.env.USER_TYPE = 'external'
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-rebuild-'))
  try {
    const path = join(dir, 'session.jsonl')
    const listingUuid = '00000000-0000-4000-8000-00000000e002'
    const userUuid = '00000000-0000-4000-8000-00000000e001'
    await writeFile(
      path,
      `${JSON.stringify({
        type: 'user',
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-08-07T00:00:00.000Z',
        cwd: '/tmp',
        sessionId: '00000000-0000-4000-8000-00000000e000',
        version: 'test',
        userType: 'external',
        isSidechain: false,
        message: { role: 'user', content: 'turn' },
      })}\n${JSON.stringify({
        type: 'attachment',
        uuid: listingUuid,
        parentUuid: userUuid,
        timestamp: '2026-08-07T00:00:00.000Z',
        cwd: '/tmp',
        sessionId: '00000000-0000-4000-8000-00000000e000',
        version: 'test',
        userType: 'external',
        isSidechain: false,
        attachment: {
          type: 'skill_listing',
          content: 'Available skills:\n- /demo',
          skillCount: 1,
          isInitial: true,
        },
      })}\n`,
    )

    resetProjectForTesting()
    setSessionFileForTesting(path)
    const map = rebuildRemoteEgressOmittedParentsForTesting()
    expect(map.has(asUuid(listingUuid))).toBe(true)
    expect(map.get(asUuid(listingUuid))).toBe(asUuid(userUuid))
  } finally {
    resetProjectForTesting()
    await rm(dir, { recursive: true, force: true })
  }
})

test('print-style resume adopt rebuilds omission map so remote append reparents past listing', async () => {
  // Mirrors print.ts --continue/--resume: switchSession → resetSessionFilePointer
  // → adoptResumedSessionFile, then the first post-resume remote/CCR append
  // whose local parentUuid is a withheld listing must reparent onto the
  // surviving ancestor (jatmn Finding 1).
  process.env.USER_TYPE = 'external'
  const originalNodeEnv = process.env.NODE_ENV
  const originalTestPersist = process.env.TEST_ENABLE_SESSION_PERSISTENCE
  const originalEnablePersist = process.env.ENABLE_SESSION_PERSISTENCE
  const originalSkipHistory = process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
  process.env.NODE_ENV = 'development'
  process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
  process.env.ENABLE_SESSION_PERSISTENCE = 'true'
  delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
  setSessionPersistenceDisabled(false)

  const sessionId = '00000000-0000-4000-8000-00000000p100'
  const userUuid = '00000000-0000-4000-8000-00000000p101'
  const listingUuid = '00000000-0000-4000-8000-00000000p102'
  const postResumeUuid = '00000000-0000-4000-8000-00000000p103'
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-print-resume-adopt-'))
  const filePath = join(dir, `${sessionId}.jsonl`)

  try {
    await writeFile(
      filePath,
      `${JSON.stringify({
        type: 'user',
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-08-08T00:00:00.000Z',
        cwd: '/tmp',
        sessionId,
        version: 'test',
        userType: 'external',
        isSidechain: false,
        message: { role: 'user', content: 'resume turn' },
      })}\n${JSON.stringify({
        type: 'attachment',
        uuid: listingUuid,
        parentUuid: userUuid,
        timestamp: '2026-08-08T00:00:01.000Z',
        cwd: '/tmp',
        sessionId,
        version: 'test',
        userType: 'external',
        isSidechain: false,
        attachment: {
          type: 'skill_listing',
          content: 'Available skills:\n- /print-resume-leak',
          skillCount: 1,
          isInitial: true,
        },
      })}\n`,
    )

    resetProjectForTesting()
    clearSessionMessagesCache()
    switchSession(sessionId as never, dir)
    await resetSessionFilePointer()

    // Pre-fix print path left the omission map empty after reset alone.
    expect(rebuildRemoteEgressOmittedParentsForTesting().size).toBe(0)

    adoptResumedSessionFile()
    const map = rebuildRemoteEgressOmittedParentsForTesting()
    expect(map.has(asUuid(listingUuid))).toBe(true)
    expect(map.get(asUuid(listingUuid))).toBe(asUuid(userUuid))

    const remotePayloads: Array<Record<string, unknown>> = []
    setInternalEventWriter(async (_eventType, payload) => {
      remotePayloads.push(payload)
    })

    clearSessionMessagesCache()
    await recordTranscript(
      [
        {
          type: 'assistant',
          uuid: postResumeUuid,
          timestamp: '2026-08-08T00:00:02.000Z',
          message: {
            id: postResumeUuid,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'post-resume reply' }],
            model: 'test-model',
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          },
        } as unknown as Message,
      ],
      undefined,
      asUuid(listingUuid),
    )
    await flushSessionStorage()

    const remoteAssistant = remotePayloads.find(
      p => (p as { uuid?: string }).uuid === postResumeUuid,
    )
    expect(remoteAssistant).toBeDefined()
    expect((remoteAssistant as { parentUuid?: string }).parentUuid).toBe(
      userUuid,
    )
    expect(JSON.stringify(remotePayloads)).not.toContain('print-resume-leak')
  } finally {
    resetProjectForTesting()
    clearSessionMessagesCache()
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
    if (originalTestPersist === undefined) {
      delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
    } else {
      process.env.TEST_ENABLE_SESSION_PERSISTENCE = originalTestPersist
    }
    if (originalEnablePersist === undefined) {
      delete process.env.ENABLE_SESSION_PERSISTENCE
    } else {
      process.env.ENABLE_SESSION_PERSISTENCE = originalEnablePersist
    }
    if (originalSkipHistory === undefined) {
      delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    } else {
      process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = originalSkipHistory
    }
    await rm(dir, { recursive: true, force: true })
  }
})

function enablePrintResumePersistenceForTest(): {
  restore: () => void
} {
  const originalNodeEnv = process.env.NODE_ENV
  const originalTestPersist = process.env.TEST_ENABLE_SESSION_PERSISTENCE
  const originalEnablePersist = process.env.ENABLE_SESSION_PERSISTENCE
  const originalSkipHistory = process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
  process.env.NODE_ENV = 'development'
  process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
  process.env.ENABLE_SESSION_PERSISTENCE = 'true'
  delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
  setSessionPersistenceDisabled(false)
  return {
    restore: () => {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }
      if (originalTestPersist === undefined) {
        delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
      } else {
        process.env.TEST_ENABLE_SESSION_PERSISTENCE = originalTestPersist
      }
      if (originalEnablePersist === undefined) {
        delete process.env.ENABLE_SESSION_PERSISTENCE
      } else {
        process.env.ENABLE_SESSION_PERSISTENCE = originalEnablePersist
      }
      if (originalSkipHistory === undefined) {
        delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
      } else {
        process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = originalSkipHistory
      }
    },
  }
}

function postResumeAssistantMessage(uuid: string, text: string): Message {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-08-08T00:00:02.000Z',
    message: {
      id: uuid,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'test-model',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as unknown as Message
}

test('print-style resume WITHOUT adopt leaves remote parentUuid on withheld listing', async () => {
  // Negative control for Finding 1: the old print path only resetSessionFilePointer,
  // so remoteEgressOmittedParents stayed empty and the first CCR append kept a
  // parentUuid pointing at a listing UUID that never reaches remote hydrate.
  process.env.USER_TYPE = 'external'
  const persist = enablePrintResumePersistenceForTest()

  const sessionId = '00000000-0000-4000-8000-00000000n100'
  const userUuid = '00000000-0000-4000-8000-00000000n101'
  const listingUuid = '00000000-0000-4000-8000-00000000n102'
  const postResumeUuid = '00000000-0000-4000-8000-00000000n103'
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-print-resume-no-adopt-'))
  const filePath = join(dir, `${sessionId}.jsonl`)

  try {
    await writeFile(
      filePath,
      `${JSON.stringify({
        type: 'user',
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-08-08T00:00:00.000Z',
        cwd: '/tmp',
        sessionId,
        version: 'test',
        userType: 'external',
        isSidechain: false,
        message: { role: 'user', content: 'resume turn' },
      })}\n${JSON.stringify({
        type: 'attachment',
        uuid: listingUuid,
        parentUuid: userUuid,
        timestamp: '2026-08-08T00:00:01.000Z',
        cwd: '/tmp',
        sessionId,
        version: 'test',
        userType: 'external',
        isSidechain: false,
        attachment: {
          type: 'skill_listing',
          content: 'Available skills:\n- /no-adopt-leak',
          skillCount: 1,
          isInitial: true,
        },
      })}\n`,
    )

    resetProjectForTesting()
    clearSessionMessagesCache()
    switchSession(sessionId as never, dir)
    await resetSessionFilePointer()
    // Deliberately skip adoptResumedSessionFile — pre-fix print behavior.
    expect(rebuildRemoteEgressOmittedParentsForTesting().size).toBe(0)

    const remotePayloads: Array<Record<string, unknown>> = []
    setInternalEventWriter(async (_eventType, payload) => {
      remotePayloads.push(payload)
    })

    clearSessionMessagesCache()
    await recordTranscript(
      [postResumeAssistantMessage(postResumeUuid, 'post-resume reply')],
      undefined,
      asUuid(listingUuid),
    )
    await flushSessionStorage()

    const remoteAssistant = remotePayloads.find(
      p => (p as { uuid?: string }).uuid === postResumeUuid,
    )
    expect(remoteAssistant).toBeDefined()
    expect((remoteAssistant as { parentUuid?: string }).parentUuid).toBe(
      listingUuid,
    )
  } finally {
    resetProjectForTesting()
    clearSessionMessagesCache()
    persist.restore()
    await rm(dir, { recursive: true, force: true })
  }
})

test('print-style resume adopt keeps listing locally while remote reparents and strips catalog', async () => {
  // Different angle from the happy-path remote assert: local JSONL must remain
  // byte-stable for --resume prefix (listing stays, assistant still chains from
  // listingUuid), while the CCR payload alone is reparented + catalog-free.
  process.env.USER_TYPE = 'external'
  const persist = enablePrintResumePersistenceForTest()

  const sessionId = '00000000-0000-4000-8000-00000000l100'
  const userUuid = '00000000-0000-4000-8000-00000000l101'
  const listingUuid = '00000000-0000-4000-8000-00000000l102'
  const postResumeUuid = '00000000-0000-4000-8000-00000000l103'
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-print-resume-local-'))
  const filePath = join(dir, `${sessionId}.jsonl`)

  try {
    await writeFile(
      filePath,
      `${JSON.stringify({
        type: 'user',
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-08-08T00:00:00.000Z',
        cwd: '/tmp',
        sessionId,
        version: 'test',
        userType: 'external',
        isSidechain: false,
        message: { role: 'user', content: 'resume turn' },
      })}\n${JSON.stringify({
        type: 'attachment',
        uuid: listingUuid,
        parentUuid: userUuid,
        timestamp: '2026-08-08T00:00:01.000Z',
        cwd: '/tmp',
        sessionId,
        version: 'test',
        userType: 'external',
        isSidechain: false,
        attachment: {
          type: 'skill_listing',
          content: 'Available skills:\n- /local-keep-leak',
          skillCount: 1,
          isInitial: true,
        },
      })}\n`,
    )

    resetProjectForTesting()
    clearSessionMessagesCache()
    switchSession(sessionId as never, dir)
    await resetSessionFilePointer()
    adoptResumedSessionFile()

    const remotePayloads: Array<Record<string, unknown>> = []
    setInternalEventWriter(async (_eventType, payload) => {
      remotePayloads.push(payload)
    })

    clearSessionMessagesCache()
    await recordTranscript(
      [postResumeAssistantMessage(postResumeUuid, 'post-resume reply')],
      undefined,
      asUuid(listingUuid),
    )
    await flushSessionStorage()

    const localText = await readFile(filePath, 'utf8')
    expect(localText).toContain('/local-keep-leak')
    expect(localText).toContain(`"uuid":"${listingUuid}"`)
    const localAssistant = localText
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { uuid?: string; parentUuid?: string })
      .find(entry => entry.uuid === postResumeUuid)
    expect(localAssistant?.parentUuid).toBe(listingUuid)

    const remoteAssistant = remotePayloads.find(
      p => (p as { uuid?: string }).uuid === postResumeUuid,
    )
    expect(remoteAssistant).toBeDefined()
    expect((remoteAssistant as { parentUuid?: string }).parentUuid).toBe(
      userUuid,
    )
    expect(JSON.stringify(remotePayloads)).not.toContain('local-keep-leak')
  } finally {
    resetProjectForTesting()
    clearSessionMessagesCache()
    persist.restore()
    await rm(dir, { recursive: true, force: true })
  }
})

test('print-style resume adopt reparents past a multi-listing prefix chain', async () => {
  // Different angle: rebuild must compress nested listing omissions
  // (skill_listing → agent_listing_delta) so one remote hop lands on the user.
  process.env.USER_TYPE = 'external'
  const persist = enablePrintResumePersistenceForTest()

  const sessionId = '00000000-0000-4000-8000-00000000m100'
  const userUuid = '00000000-0000-4000-8000-00000000m101'
  const skillListingUuid = '00000000-0000-4000-8000-00000000m102'
  const agentListingUuid = '00000000-0000-4000-8000-00000000m103'
  const postResumeUuid = '00000000-0000-4000-8000-00000000m104'
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-print-resume-multi-'))
  const filePath = join(dir, `${sessionId}.jsonl`)

  try {
    await writeFile(
      filePath,
      `${JSON.stringify({
        type: 'user',
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-08-08T00:00:00.000Z',
        cwd: '/tmp',
        sessionId,
        version: 'test',
        userType: 'external',
        isSidechain: false,
        message: { role: 'user', content: 'resume turn' },
      })}\n${JSON.stringify({
        type: 'attachment',
        uuid: skillListingUuid,
        parentUuid: userUuid,
        timestamp: '2026-08-08T00:00:01.000Z',
        cwd: '/tmp',
        sessionId,
        version: 'test',
        userType: 'external',
        isSidechain: false,
        attachment: {
          type: 'skill_listing',
          content: 'Available skills:\n- /multi-chain-a',
          skillCount: 1,
          isInitial: true,
        },
      })}\n${JSON.stringify({
        type: 'attachment',
        uuid: agentListingUuid,
        parentUuid: skillListingUuid,
        timestamp: '2026-08-08T00:00:01.500Z',
        cwd: '/tmp',
        sessionId,
        version: 'test',
        userType: 'external',
        isSidechain: false,
        attachment: {
          type: 'agent_listing_delta',
          addedTypes: ['Explore'],
          addedLines: ['- Explore: stub'],
          removedTypes: [],
          isInitial: true,
          showConcurrencyNote: true,
        },
      })}\n`,
    )

    resetProjectForTesting()
    clearSessionMessagesCache()
    switchSession(sessionId as never, dir)
    await resetSessionFilePointer()
    adoptResumedSessionFile()

    const map = rebuildRemoteEgressOmittedParentsForTesting()
    expect(map.get(asUuid(skillListingUuid))).toBe(asUuid(userUuid))
    // Nested omission compresses through the prior listing onto the user.
    expect(map.get(asUuid(agentListingUuid))).toBe(asUuid(userUuid))

    const remotePayloads: Array<Record<string, unknown>> = []
    setInternalEventWriter(async (_eventType, payload) => {
      remotePayloads.push(payload)
    })

    clearSessionMessagesCache()
    await recordTranscript(
      [postResumeAssistantMessage(postResumeUuid, 'post-resume reply')],
      undefined,
      asUuid(agentListingUuid),
    )
    await flushSessionStorage()

    const remoteAssistant = remotePayloads.find(
      p => (p as { uuid?: string }).uuid === postResumeUuid,
    )
    expect(remoteAssistant).toBeDefined()
    expect((remoteAssistant as { parentUuid?: string }).parentUuid).toBe(
      userUuid,
    )
    expect(JSON.stringify(remotePayloads)).not.toContain('multi-chain-a')
    expect(JSON.stringify(remotePayloads)).not.toContain('Explore: stub')
  } finally {
    resetProjectForTesting()
    clearSessionMessagesCache()
    persist.restore()
    await rm(dir, { recursive: true, force: true })
  }
})
