import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isSessionPersistenceDisabled,
  setSessionPersistenceDisabled,
} from '../bootstrap/state.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import type { Message } from '../types/message.js'
import {
  clearSessionMessagesCache,
  filterJsonlForExternalEgress,
  filterMessagesForExternalEgress,
  filterSubagentTranscriptsForExternalEgress,
  flushSessionStorage,
  getRemoteEgressOmittedParentsForTesting,
  isSafeForExternalEgress,
  EXTERNAL_EGRESS_LISTING_ATTACHMENT_TYPES,
  MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE,
  OMISSION_REBUILD_TAIL_BYTES,
  projectTranscriptParentForExternalEgress,
  rebuildRemoteEgressOmittedParentsForTesting,
  recordExternalEgressOmission,
  recordTranscript,
  resetProjectForTesting,
  setInternalEventWriter,
  setSessionFileForTesting,
} from './sessionStorage.js'

const originalUserType = process.env.USER_TYPE
const originalHookSave = process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT
const originalEnablePersist = process.env.ENABLE_SESSION_PERSISTENCE
const originalTestPersist = process.env.TEST_ENABLE_SESSION_PERSISTENCE
const originalNodeEnv = process.env.NODE_ENV
const originalSkipHistory = process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
// Snapshot/restore sessionPersistenceDisabled so append tests that force
// persistence on cannot leak enabled writes into later suites (order-safe).
const originalSessionPersistenceDisabled = isSessionPersistenceDisabled()
let ownsSharedMutationLock = false

beforeEach(async () => {
  ownsSharedMutationLock = false
  await acquireSharedMutationLock('utils/sessionStorage.externalEgress.test.ts')
  ownsSharedMutationLock = true
})

afterEach(() => {
  try {
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
  if (originalEnablePersist === undefined) {
    delete process.env.ENABLE_SESSION_PERSISTENCE
  } else {
    process.env.ENABLE_SESSION_PERSISTENCE = originalEnablePersist
  }
  if (originalTestPersist === undefined) {
    delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
  } else {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = originalTestPersist
  }
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
  if (originalSkipHistory === undefined) {
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
  } else {
    process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = originalSkipHistory
  }
  setSessionPersistenceDisabled(originalSessionPersistenceDisabled)
  resetProjectForTesting()
  clearSessionMessagesCache()
  } finally {
    if (ownsSharedMutationLock) {
      ownsSharedMutationLock = false
      releaseSharedMutationLock()
    }
  }
})

describe('sessionPersistenceDisabled suite isolation', () => {
  test('step1: append-style mutation leaves flag away from suite snapshot', () => {
    setSessionPersistenceDisabled(!originalSessionPersistenceDisabled)
    expect(isSessionPersistenceDisabled()).not.toBe(
      originalSessionPersistenceDisabled,
    )
  })

  test('step2: afterEach restored the suite snapshot from step1', () => {
    expect(isSessionPersistenceDisabled()).toBe(
      originalSessionPersistenceDisabled,
    )
  })
})

function id(n: number): UUID {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as UUID
}

function user(uuid: UUID, parentUuid: UUID | null, content: string) {
  return {
    type: 'user' as const,
    uuid,
    parentUuid,
    message: { role: 'user' as const, content },
  }
}

function listing(
  uuid: UUID,
  parentUuid: UUID | null,
  attachmentType: string,
  leakToken: string,
) {
  return {
    type: 'attachment' as const,
    uuid,
    parentUuid,
    attachment: {
      type: attachmentType,
      content: leakToken,
      isInitial: true,
    },
  }
}

function hookAttachment(uuid: UUID, parentUuid: UUID | null, leak: string) {
  return {
    type: 'attachment' as const,
    uuid,
    parentUuid,
    attachment: {
      type: 'hook_additional_context',
      content: leak,
      hookName: 'SessionStart',
      toolName: 'SessionStart',
      hookEvent: 'SessionStart',
      stdout: leak,
      stderr: '',
      exitCode: 0,
    },
  }
}

describe('isSafeForExternalEgress', () => {
  test('rejects every external-egress listing type for external users', () => {
    process.env.USER_TYPE = 'external'
    for (const attachmentType of EXTERNAL_EGRESS_LISTING_ATTACHMENT_TYPES) {
      expect(
        isSafeForExternalEgress({
          type: 'attachment',
          attachment: { type: attachmentType },
        }),
      ).toBe(false)
    }
  })

  test('rejects listing types for ant users too', () => {
    process.env.USER_TYPE = 'ant'
    for (const attachmentType of EXTERNAL_EGRESS_LISTING_ATTACHMENT_TYPES) {
      expect(
        isSafeForExternalEgress({
          type: 'attachment',
          attachment: { type: attachmentType },
        }),
      ).toBe(false)
    }
  })

  test('rejects skill_discovery for ant users (denylist membership)', () => {
    process.env.USER_TYPE = 'ant'
    expect(EXTERNAL_EGRESS_LISTING_ATTACHMENT_TYPES.has('skill_discovery')).toBe(
      true,
    )
    expect(
      isSafeForExternalEgress({
        type: 'attachment',
        attachment: {
          type: 'skill_discovery',
          skills: [{ name: 'leak-discovery', description: 'must not egress' }],
        },
      }),
    ).toBe(false)
  })

  test('rejects progress for both ant and external', () => {
    process.env.USER_TYPE = 'external'
    expect(isSafeForExternalEgress({ type: 'progress' })).toBe(false)
    process.env.USER_TYPE = 'ant'
    expect(isSafeForExternalEgress({ type: 'progress' })).toBe(false)
  })

  test('allows plain user messages for external users', () => {
    process.env.USER_TYPE = 'external'
    expect(isSafeForExternalEgress({ type: 'user' })).toBe(true)
  })

  test('blocks hook_additional_context for external even when local-save flag is on', () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    expect(
      isSafeForExternalEgress({
        type: 'attachment',
        attachment: { type: 'hook_additional_context', content: 'HOOK-LEAK' },
      }),
    ).toBe(false)
  })

  test('allows hook_additional_context for ant without the local-save flag', () => {
    process.env.USER_TYPE = 'ant'
    delete process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT
    expect(
      isSafeForExternalEgress({
        type: 'attachment',
        attachment: { type: 'hook_additional_context', content: 'ant-ok' },
      }),
    ).toBe(true)
  })

  test('ant still blocks listings while allowing non-listing attachments', () => {
    process.env.USER_TYPE = 'ant'
    expect(
      isSafeForExternalEgress({
        type: 'attachment',
        attachment: { type: 'skill_listing', content: 'nope' },
      }),
    ).toBe(false)
    expect(
      isSafeForExternalEgress({
        type: 'attachment',
        attachment: { type: 'hook_additional_context', content: 'ok' },
      }),
    ).toBe(true)
  })
})

describe('filterMessagesForExternalEgress', () => {
  test('strips listings and reparents the next survivor', () => {
    process.env.USER_TYPE = 'external'
    const u1 = user(id(1), null, 'first')
    const leak = listing(id(2), id(1), 'skill_listing', 'LEAK-SKILL')
    const u2 = user(id(3), id(2), 'second')

    const filtered = filterMessagesForExternalEgress([u1, leak, u2])
    expect(filtered).toHaveLength(2)
    expect(filtered[0]?.uuid).toBe(id(1))
    expect(filtered[1]?.uuid).toBe(id(3))
    expect(filtered[1]?.parentUuid).toBe(id(1))
    expect(JSON.stringify(filtered)).not.toContain('LEAK-SKILL')
  })

  test('chain-resolves through consecutive omissions', () => {
    process.env.USER_TYPE = 'external'
    const u1 = user(id(1), null, 'first')
    const a = listing(id(2), id(1), 'skill_listing', 'LEAK-A')
    const b = listing(id(3), id(2), 'agent_listing_delta', 'LEAK-B')
    const u2 = user(id(4), id(3), 'after')

    const filtered = filterMessagesForExternalEgress([u1, a, b, u2])
    expect(filtered.map(m => m.uuid)).toEqual([id(1), id(4)])
    expect(filtered[1]?.parentUuid).toBe(id(1))
  })

  test('strips hook_additional_context for external even with SAVE flag', () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = 'true'
    const u1 = user(id(1), null, 'first')
    const hook = hookAttachment(id(2), id(1), 'HOOK-SAVE-LEAK')
    const u2 = user(id(3), id(2), 'after-hook')
    const filtered = filterMessagesForExternalEgress([u1, hook, u2])
    expect(filtered.map(m => m.uuid)).toEqual([id(1), id(3)])
    expect(filtered[1]?.parentUuid).toBe(id(1))
    expect(JSON.stringify(filtered)).not.toContain('HOOK-SAVE-LEAK')
  })
})

describe('filterJsonlForExternalEgress', () => {
  test('strips listing lines and rewrites parentUuid on survivors', () => {
    process.env.USER_TYPE = 'external'
    const lines = [
      JSON.stringify(user(id(1), null, 'first')),
      JSON.stringify(
        listing(id(2), id(1), 'deferred_tools_delta', 'LEAK-JSONL'),
      ),
      JSON.stringify(user(id(3), id(2), 'third')),
    ]
    const out = filterJsonlForExternalEgress(lines.join('\n'))
    const parsed = out
      .split('\n')
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l) as { uuid: string; parentUuid: string | null })
    expect(parsed).toHaveLength(2)
    expect(parsed[0]?.uuid).toBe(id(1))
    expect(parsed[1]?.uuid).toBe(id(3))
    expect(parsed[1]?.parentUuid).toBe(id(1))
    expect(out).not.toContain('LEAK-JSONL')
  })

  test('fail-closes malformed non-empty JSONL lines', () => {
    process.env.USER_TYPE = 'external'
    const out = filterJsonlForExternalEgress(
      [
        JSON.stringify(user(id(1), null, 'ok')),
        '{not-json',
        JSON.stringify(user(id(2), id(1), 'still-ok')),
      ].join('\n'),
    )
    expect(out).not.toContain('{not-json')
    expect(out).toContain('still-ok')
    expect(out.split('\n').filter(l => l.length > 0)).toHaveLength(2)
  })
})

describe('filterSubagentTranscriptsForExternalEgress', () => {
  test('strips listings per agent independently', () => {
    process.env.USER_TYPE = 'external'
    const filtered = filterSubagentTranscriptsForExternalEgress({
      a: [
        listing(id(1), null, 'mcp_instructions_delta', 'LEAK-A'),
        user(id(2), id(1), 'agent-a'),
      ],
      b: [user(id(3), null, 'agent-b')],
    })
    expect(filtered.a?.map(m => m.uuid)).toEqual([id(2)])
    expect(filtered.a?.[0]?.parentUuid).toBeNull()
    expect(filtered.b?.map(m => m.uuid)).toEqual([id(3)])
    expect(JSON.stringify(filtered)).not.toContain('LEAK-A')
  })
})

describe('recordExternalEgressOmission / projectTranscriptParentForExternalEgress', () => {
  test('projects parent across a single omission map entry', () => {
    const map = new Map<UUID, UUID | null>()
    recordExternalEgressOmission(map, id(2), id(1))
    const projected = projectTranscriptParentForExternalEgress(
      { parentUuid: id(2) as UUID | null },
      map,
    )
    expect(projected.parentUuid).toBe(id(1))
  })
})

describe('rebuildRemoteEgressOmittedParentsFromLocalTranscript', () => {
  test('rebuilds omission map from local JSONL so post-resume parents reparent', async () => {
    process.env.USER_TYPE = 'external'
    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-rebuild-'))
    const path = join(dir, 'session.jsonl')
    const userUuid = id(1)
    const listingUuid = id(2)
    try {
      await writeFile(
        path,
        [
          JSON.stringify(user(userUuid, null, 'resume turn')),
          '{not-json',
          JSON.stringify(
            listing(listingUuid, userUuid, 'skill_listing', 'REBUILD-LEAK'),
          ),
        ].join('\n') + '\n',
      )
      resetProjectForTesting()
      setSessionFileForTesting(path)
      rebuildRemoteEgressOmittedParentsForTesting()
      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.has(listingUuid)).toBe(true)
      expect(map.get(listingUuid)).toBe(userUuid)
      const projected = projectTranscriptParentForExternalEgress(
        { parentUuid: listingUuid },
        map,
      )
      expect(projected.parentUuid).toBe(userUuid)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('bounded tail rebuild recovers recent omissions when over OMISSION_REBUILD_TAIL_BYTES', async () => {
    process.env.USER_TYPE = 'external'
    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-rebuild-tail-'))
    const path = join(dir, 'session.jsonl')
    const userUuid = id(21)
    const listingUuid = id(22)
    try {
      // Prefix larger than the rebuild budget so the oversized path runs.
      await writeFile(path, Buffer.alloc(OMISSION_REBUILD_TAIL_BYTES + 1, 0x78))
      await appendFile(
        path,
        '\n' +
          [
            JSON.stringify(user(userUuid, null, 'tail resume turn')),
            JSON.stringify(
              listing(listingUuid, userUuid, 'skill_listing', 'TAIL-LEAK'),
            ),
          ].join('\n') +
          '\n',
      )
      resetProjectForTesting()
      setSessionFileForTesting(path)
      rebuildRemoteEgressOmittedParentsForTesting()
      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.has(listingUuid)).toBe(true)
      expect(map.get(listingUuid)).toBe(userUuid)
      const projected = projectTranscriptParentForExternalEgress(
        { parentUuid: listingUuid },
        map,
      )
      expect(projected.parentUuid).toBe(userUuid)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('bounded tail rebuild keeps the first complete JSONL line when the window starts on a line boundary', async () => {
    process.env.USER_TYPE = 'external'
    const dir = await mkdtemp(
      join(tmpdir(), 'openclaude-egress-rebuild-boundary-'),
    )
    const path = join(dir, 'session.jsonl')
    const userUuid = id(23)
    const listingUuid = id(24)
    try {
      const listingLine =
        JSON.stringify(
          listing(listingUuid, userUuid, 'skill_listing', 'BOUNDARY-LEAK'),
        ) + '\n'
      const listingBytes = Buffer.byteLength(listingLine)
      // Force the OMISSION_REBUILD_TAIL_BYTES window to begin exactly at the
      // first byte of listingLine (previous byte is \n). Slicing at the first
      // newline would discard this complete omission record.
      const fillerExtra = 64
      const prefix = Buffer.concat([
        Buffer.alloc(fillerExtra - 1, 0x78),
        Buffer.from('\n'),
      ])
      const body = Buffer.concat([
        Buffer.from(listingLine),
        Buffer.alloc(OMISSION_REBUILD_TAIL_BYTES - listingBytes, 0x78),
      ])
      await writeFile(path, Buffer.concat([prefix, body]))
      resetProjectForTesting()
      setSessionFileForTesting(path)
      rebuildRemoteEgressOmittedParentsForTesting()
      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.has(listingUuid)).toBe(true)
      expect(map.get(listingUuid)).toBe(userUuid)
      const projected = projectTranscriptParentForExternalEgress(
        { parentUuid: listingUuid },
        map,
      )
      expect(projected.parentUuid).toBe(userUuid)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('ancestry-closure rebuild walks past a metadata-only tail larger than OMISSION_REBUILD_TAIL_BYTES', async () => {
    process.env.USER_TYPE = 'external'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(
      join(tmpdir(), 'openclaude-egress-rebuild-ancestry-'),
    )
    const path = join(dir, 'session.jsonl')
    const userUuid = id(30)
    const listingUuid = id(31)
    const afterUuid = id(32)
    const remotePayloads: Array<Record<string, unknown>> = []
    try {
      const prefix =
        [
          JSON.stringify(user(userUuid, null, 'ancestry resume turn')),
          JSON.stringify(
            listing(listingUuid, userUuid, 'skill_listing', 'ANCESTRY-LEAK'),
          ),
        ].join('\n') + '\n'
      // Many ~1KB non-transcript lines — not one huge line — so the default
      // tail window is metadata-only and the chain tip sits earlier.
      const snapshotPad = 's'.repeat(900)
      const snapshotLines: string[] = []
      let snapshotBytes = 0
      let i = 0
      while (snapshotBytes <= OMISSION_REBUILD_TAIL_BYTES) {
        const line =
          JSON.stringify({
            type: 'file-history-snapshot',
            messageId: id(2000 + i),
            snapshot: { pad: snapshotPad, i },
            isSnapshotUpdate: false,
          }) + '\n'
        snapshotLines.push(line)
        snapshotBytes += Buffer.byteLength(line)
        i += 1
      }
      await writeFile(path, prefix + snapshotLines.join(''))
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)
      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })
      rebuildRemoteEgressOmittedParentsForTesting()
      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.has(listingUuid)).toBe(true)
      expect(map.get(listingUuid)).toBe(userUuid)

      const afterMsg = {
        type: 'user',
        uuid: afterUuid,
        parentUuid: listingUuid,
        timestamp: '2026-08-11T00:00:00.000Z',
        message: { role: 'user', content: 'first post-resume' },
      } as unknown as Message
      await recordTranscript([afterMsg], undefined, listingUuid)
      await flushSessionStorage()

      const remoteAfter = remotePayloads.find(p => p.uuid === afterUuid)
      expect(remoteAfter).toBeDefined()
      expect(remoteAfter?.parentUuid).toBe(userUuid)
      expect(JSON.stringify(remotePayloads)).not.toContain('ANCESTRY-LEAK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('appendEntry remote egress gate', () => {
  // External isLoggableMessage drops listings, but keeps hook_additional_context
  // when CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT is set. That local-save gate
  // must NOT widen remote egress — these tests pin that boundary.
  test('records omission with an active sink for locally-saved hook and reparents next remote entry', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-append-'))
    const path = join(dir, 'session.jsonl')
    const userUuid = id(10)
    const hookUuid = id(11)
    const afterUuid = id(12)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      await writeFile(path, '')
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)
      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      const hookMsg = {
        type: 'attachment',
        uuid: hookUuid,
        parentUuid: userUuid,
        timestamp: '2026-08-10T00:00:01.000Z',
        attachment: {
          type: 'hook_additional_context',
          content: 'HOOK-APPEND-LEAK',
          hookName: 'SessionStart',
          toolName: 'SessionStart',
          hookEvent: 'SessionStart',
          stdout: 'HOOK-APPEND-LEAK',
          stderr: '',
          exitCode: 0,
        },
      } as unknown as Message

      const afterMsg = {
        type: 'user',
        uuid: afterUuid,
        parentUuid: hookUuid,
        timestamp: '2026-08-10T00:00:02.000Z',
        message: { role: 'user', content: 'after hook' },
      } as unknown as Message

      const seedUser = {
        type: 'user',
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-08-10T00:00:00.000Z',
        message: { role: 'user', content: 'seed' },
      } as unknown as Message

      await recordTranscript([seedUser])
      await flushSessionStorage()
      remotePayloads.length = 0

      await recordTranscript([hookMsg, afterMsg], undefined, userUuid)
      await flushSessionStorage()

      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.has(hookUuid)).toBe(false)

      const remoteAfter = remotePayloads.find(p => p.uuid === afterUuid)
      expect(remoteAfter).toBeDefined()
      expect(remoteAfter?.parentUuid).toBe(userUuid)
      expect(JSON.stringify(remotePayloads)).not.toContain('HOOK-APPEND-LEAK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('does not grow omission map when no remote sink is registered', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-nosink-'))
    const path = join(dir, 'session.jsonl')
    const userUuid = id(20)
    const hookUuid = id(21)

    try {
      await writeFile(path, '')
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)
      // No setInternalEventWriter / remote ingress → hasActiveRemoteEgressSink false

      const seedUser = {
        type: 'user',
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-08-10T00:00:00.000Z',
        message: { role: 'user', content: 'seed' },
      } as unknown as Message
      const hookMsg = {
        type: 'attachment',
        uuid: hookUuid,
        parentUuid: userUuid,
        timestamp: '2026-08-10T00:00:01.000Z',
        attachment: {
          type: 'hook_additional_context',
          content: 'HOOK-NOSINK',
          hookName: 'SessionStart',
          toolName: 'SessionStart',
          hookEvent: 'SessionStart',
          stdout: 'HOOK-NOSINK',
          stderr: '',
          exitCode: 0,
        },
      } as unknown as Message

      await recordTranscript([seedUser, hookMsg])
      await flushSessionStorage()

      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.has(hookUuid)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('bounds live omission map and still reparents the next safe entry', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-bound-'))
    const path = join(dir, 'session.jsonl')
    const userUuid = id(100)
    const firstListing = id(101)
    const lastListing = id(100 + MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE + 16)
    const afterUuid = id(200)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      await writeFile(path, '')
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)
      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      const seedUser = {
        type: 'user',
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:00:00.000Z',
        message: { role: 'user', content: 'seed' },
      } as unknown as Message
      await recordTranscript([seedUser])
      await flushSessionStorage()
      remotePayloads.length = 0

      const listings: Message[] = []
      let parent: UUID = userUuid
      for (let n = 0; n < MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE + 16; n++) {
        const uuid = id(101 + n)
        listings.push({
          type: 'attachment',
          uuid,
          parentUuid: parent,
          timestamp: `2026-08-11T00:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`,
          attachment: {
            type: 'hook_additional_context',
            content: `BOUND-LEAK-${n}`,
            hookName: 'SessionStart',
            toolName: 'SessionStart',
            hookEvent: 'SessionStart',
            stdout: `BOUND-LEAK-${n}`,
            stderr: '',
            exitCode: 0,
          },
        } as unknown as Message)
        parent = uuid
      }
      await recordTranscript(listings, undefined, userUuid)
      await flushSessionStorage()

      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.size).toBeLessThanOrEqual(MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE)
      expect(map.has(firstListing)).toBe(false)
      expect(map.has(lastListing)).toBe(true)

      const afterMsg = {
        type: 'user',
        uuid: afterUuid,
        parentUuid: lastListing,
        timestamp: '2026-08-11T00:01:00.000Z',
        message: { role: 'user', content: 'after bound listings' },
      } as unknown as Message
      await recordTranscript([afterMsg], undefined, lastListing)
      await flushSessionStorage()

      const remoteAfter = remotePayloads.find(p => p.uuid === afterUuid)
      expect(remoteAfter).toBeDefined()
      expect(remoteAfter?.parentUuid).toBe(userUuid)
      expect(JSON.stringify(remotePayloads)).not.toContain('BOUND-LEAK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('compact ancestry fallback reparents a child of the oldest UUID after more than 129 omissions', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const omissionCount = MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE * 2 + 2
    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-ancestry-'))
    const path = join(dir, 'session.jsonl')
    const userUuid = id(300)
    const firstListing = id(301)
    const afterUuid = id(500)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      await writeFile(path, '')
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)
      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      const seedUser = {
        type: 'user',
        uuid: userUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:00:00.000Z',
        message: { role: 'user', content: 'seed' },
      } as unknown as Message
      await recordTranscript([seedUser])
      await flushSessionStorage()
      remotePayloads.length = 0

      const listings: Message[] = []
      let parent: UUID = userUuid
      for (let n = 0; n < omissionCount; n++) {
        const uuid = id(301 + n)
        listings.push({
          type: 'attachment',
          uuid,
          parentUuid: parent,
          timestamp: `2026-08-11T00:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`,
          attachment: {
            type: 'hook_additional_context',
            content: `ANCESTRY-LEAK-${n}`,
            hookName: 'SessionStart',
            toolName: 'SessionStart',
            hookEvent: 'SessionStart',
            stdout: `ANCESTRY-LEAK-${n}`,
            stderr: '',
            exitCode: 0,
          },
        } as unknown as Message)
        parent = uuid
      }
      await recordTranscript(listings, undefined, userUuid)
      await flushSessionStorage()

      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.size).toBeLessThanOrEqual(MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE)
      expect(map.has(firstListing)).toBe(false)
      expect(omissionCount).toBeGreaterThan(129)

      const afterMsg = {
        type: 'user',
        uuid: afterUuid,
        parentUuid: firstListing,
        timestamp: '2026-08-11T00:03:00.000Z',
        message: { role: 'user', content: 'child of oldest omitted uuid' },
      } as unknown as Message
      await recordTranscript([afterMsg], undefined, firstListing)
      await flushSessionStorage()

      const remoteAfter = remotePayloads.find(p => p.uuid === afterUuid)
      expect(remoteAfter).toBeDefined()
      expect(remoteAfter?.parentUuid).toBe(userUuid)
      expect(remoteAfter?.parentUuid).not.toBe(firstListing)
      expect(JSON.stringify(remotePayloads)).not.toContain('ANCESTRY-LEAK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
