import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildConversationChain,
  loadTranscriptFile,
  stripPersistedToolUseResultsFromJSONLBuffer,
} from './sessionStorage.ts'

const tempDirs: string[] = []
const sessionId = '00000000-0000-4000-8000-000000000999'
const ts = '2026-04-02T00:00:00.000Z'

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

function base(uuid: string, parentUuid: string | null) {
  return {
    uuid,
    parentUuid,
    timestamp: ts,
    cwd: '/tmp',
    userType: 'external',
    sessionId,
    version: 'test',
    isSidechain: false,
  }
}

function user(uuid: string, parentUuid: string | null, content: string) {
  return {
    ...base(uuid, parentUuid),
    type: 'user',
    isMeta: false,
    message: {
      role: 'user',
      content,
    },
  }
}

function assistant(uuid: string, parentUuid: string | null, text: string) {
  return {
    ...base(uuid, parentUuid),
    type: 'assistant',
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
  }
}

function compactBoundary(
  uuid: string,
  parentUuid: string | null,
  preservedSegment: {
    headUuid: string
    anchorUuid: string
    tailUuid: string
  },
) {
  return {
    ...base(uuid, parentUuid),
    type: 'system',
    subtype: 'compact_boundary',
    level: 'info',
    isMeta: false,
    content: 'Conversation compacted',
    compactMetadata: {
      trigger: 'manual',
      preTokens: 123,
      preservedSegment,
    },
  }
}

async function writeJsonl(entries: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-session-storage-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'session.jsonl')
  await writeFile(filePath, `${entries.map(e => JSON.stringify(e)).join('\n')}\n`)
  return filePath
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

test('loadTranscriptFile fails closed when preserved-segment tail is missing', async () => {
  const oldUser = user(id(1), null, 'old user')
  const oldAssistant = assistant(id(2), id(1), 'old assistant')
  const preservedHead = assistant(id(3), id(2), 'preserved head')
  const boundary = compactBoundary(id(4), id(2), {
    headUuid: id(3),
    anchorUuid: id(5),
    tailUuid: id(30),
  })
  const summary = user(id(5), id(4), 'summary')

  const filePath = await writeJsonl([
    oldUser,
    oldAssistant,
    preservedHead,
    boundary,
    summary,
  ])

  const { messages } = await loadTranscriptFile(filePath)
  expect(messages.has(id(1) as any)).toBe(false)
  expect(messages.has(id(2) as any)).toBe(false)
  expect(messages.has(id(3) as any)).toBe(false)
  expect(messages.has(id(4) as any)).toBe(true)
  expect(messages.has(id(5) as any)).toBe(true)

  const chain = buildConversationChain(messages, messages.get(id(5) as any)!)
  expect(chain.map(message => message.uuid)).toEqual([id(4), id(5)])
})

test('loadTranscriptFile preserves and relinks a valid preserved segment', async () => {
  const oldUser = user(id(11), null, 'old user')
  const oldAssistant = assistant(id(12), id(11), 'old assistant')
  const preservedHead = assistant(id(13), id(12), 'preserved head')
  const preservedTail = assistant(id(14), id(13), 'preserved tail')
  const boundary = compactBoundary(id(15), id(12), {
    headUuid: id(13),
    anchorUuid: id(16),
    tailUuid: id(14),
  })
  const summary = user(id(16), id(15), 'summary')

  const filePath = await writeJsonl([
    oldUser,
    oldAssistant,
    preservedHead,
    preservedTail,
    boundary,
    summary,
  ])

  const { messages } = await loadTranscriptFile(filePath)
  expect(messages.has(id(11) as any)).toBe(false)
  expect(messages.has(id(12) as any)).toBe(false)
  expect(messages.has(id(13) as any)).toBe(true)
  expect(messages.has(id(14) as any)).toBe(true)
  expect(messages.get(id(13) as any)?.parentUuid).toBe(id(16))
  expect(messages.get(id(14) as any)?.parentUuid).toBe(id(13))

  const chain = buildConversationChain(messages, messages.get(id(14) as any)!)
  expect(chain.map(message => message.uuid)).toEqual([
    id(15),
    id(16),
    id(13),
    id(14),
  ])
})

test('loadTranscriptFile fails closed when preserved-segment anchor is missing', async () => {
  // Models the case where the compact boundary was written but the post-boundary
  // summary/anchor message never made it to disk.
  const oldUser = user(id(21), null, 'old user')
  const oldAssistant = assistant(id(22), id(21), 'old assistant')
  const preservedHead = assistant(id(23), id(22), 'preserved head')
  const preservedTail = assistant(id(24), id(23), 'preserved tail')
  const boundary = compactBoundary(id(25), id(22), {
    headUuid: id(23),
    anchorUuid: id(26),
    tailUuid: id(24),
  })

  const filePath = await writeJsonl([
    oldUser,
    oldAssistant,
    preservedHead,
    preservedTail,
    boundary,
  ])

  const { messages } = await loadTranscriptFile(filePath)
  expect(messages.has(id(21) as any)).toBe(false)
  expect(messages.has(id(22) as any)).toBe(false)
  expect(messages.has(id(23) as any)).toBe(false)
  expect(messages.has(id(24) as any)).toBe(false)
  expect(messages.has(id(25) as any)).toBe(true)

  const chain = buildConversationChain(messages, messages.get(id(25) as any)!)
  expect(chain.map(message => message.uuid)).toEqual([id(25)])
})

test('stripPersistedToolUseResultsFromJSONLBuffer drops raw toolUseResult while preserving persisted preview content', () => {
  const persisted = user(id(31), null, 'placeholder')
  persisted.message = {
    role: 'user',
    // @ts-expect-error type mismatch
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool-31',
        is_error: false,
        content: '<persisted-output>\nPreview text\n</persisted-output>',
      },
    ],
  }
  ;(persisted as typeof persisted & { toolUseResult?: unknown }).toolUseResult = {
    stdout: 'x'.repeat(200_000),
    stderr: '',
  }

  const raw = Buffer.from(`${JSON.stringify(persisted)}\n`)
  const sanitized = stripPersistedToolUseResultsFromJSONLBuffer(raw)
  const [parsed] = JSON.parse(`[${sanitized.toString('utf8').trim()}]`) as Array<
    typeof persisted & { toolUseResult?: unknown }
  >

  expect(parsed?.toolUseResult).toBeUndefined()
  expect(
    // @ts-expect-error conversion mismatch
    (parsed?.message.content as Array<{ content: string }>)[0]?.content,
  ).toContain('Preview text')
})

test('loadTranscriptFile omits raw toolUseResult for persisted-output transcript entries', async () => {
  const persisted = user(id(41), null, 'placeholder')
  persisted.message = {
    role: 'user',
    // @ts-expect-error type mismatch
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool-41',
        is_error: false,
        content: '<persisted-output>\nPreview text\n</persisted-output>',
      },
    ],
  }
  ;(persisted as typeof persisted & { toolUseResult?: unknown }).toolUseResult = {
    stdout: 'y'.repeat(200_000),
    stderr: '',
  }

  const filePath = await writeJsonl([persisted])
  const { messages } = await loadTranscriptFile(filePath)
  const loaded = messages.get(id(41) as any) as (typeof persisted & {
    toolUseResult?: unknown
  }) | undefined

  expect(loaded).toBeDefined()
  expect(loaded?.toolUseResult).toBeUndefined()
  expect(
    // @ts-expect-error conversion mismatch
    (loaded?.message.content as Array<{ content: string }>)[0]?.content,
  ).toContain('Preview text')
})
