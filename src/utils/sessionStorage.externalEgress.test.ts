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
  getRemoteEgressOmissionRebuildIncompleteForTesting,
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

  test('walks transitive omission chains with a cycle guard', () => {
    const map = new Map<UUID, UUID | null>()
    // One-hop rebuild shape (not pre-compressed): O2→O1, O3→O2.
    map.set(id(2), id(1))
    map.set(id(3), id(2))
    const projected = projectTranscriptParentForExternalEgress(
      { parentUuid: id(3) as UUID | null },
      map,
    )
    expect(projected.parentUuid).toBe(id(1))

    map.set(id(4), id(5))
    map.set(id(5), id(4))
    const cyclic = projectTranscriptParentForExternalEgress(
      { parentUuid: id(4) as UUID | null },
      map,
    )
    expect(cyclic.parentUuid === id(4) || cyclic.parentUuid === id(5)).toBe(
      true,
    )
  })
})

describe('filterJsonl / filterMessages malformed attachment validation', () => {
  test('drops parseable records with attachment payload when type is not attachment', () => {
    const malformedUuid = id(40)
    const survivorUuid = id(41)
    const messages = [
      {
        type: 'user',
        uuid: malformedUuid,
        parentUuid: null,
        attachment: {
          type: 'skill_listing',
          content: 'MALFORMED-LEAK',
        },
        message: { role: 'user', content: 'spoofed' },
      },
      {
        type: 'user',
        uuid: survivorUuid,
        parentUuid: malformedUuid,
        message: { role: 'user', content: 'ok' },
      },
    ] as Array<{
      type?: string
      uuid?: UUID
      parentUuid?: UUID | null
      attachment?: unknown
      message?: { role: string; content: string }
    }>
    const filtered = filterMessagesForExternalEgress(messages)
    expect(filtered.map(m => m.uuid)).toEqual([survivorUuid])
    expect(filtered[0]?.parentUuid).toBeNull()
    expect(JSON.stringify(filtered)).not.toContain('MALFORMED-LEAK')

    const jsonl = [
      JSON.stringify(messages[0]),
      JSON.stringify(messages[1]),
    ].join('\n')
    const out = filterJsonlForExternalEgress(jsonl)
    expect(out).not.toContain('MALFORMED-LEAK')
    const kept = out
      .split('\n')
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l) as { uuid: string; parentUuid: string | null })
    expect(kept).toHaveLength(1)
    expect(kept[0]?.uuid).toBe(survivorUuid)
    expect(kept[0]?.parentUuid).toBeNull()
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

  test('bounds omission map during resume rebuild with more than 64 withheld entries', async () => {
    process.env.USER_TYPE = 'external'
    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-rebuild-bound-'))
    const path = join(dir, 'session.jsonl')
    const userUuid = id(50)
    const omissionCount = MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE + 40
    const lastListing = id(51 + omissionCount - 1)
    try {
      const lines = [JSON.stringify(user(userUuid, null, 'resume seed'))]
      let parent: UUID = userUuid
      for (let n = 0; n < omissionCount; n++) {
        const uuid = id(51 + n)
        lines.push(
          JSON.stringify(listing(uuid, parent, 'skill_listing', 'REBUILD-BOUND-LEAK')),
        )
        parent = uuid
      }
      await writeFile(path, lines.join('\n') + '\n')
      resetProjectForTesting()
      setSessionFileForTesting(path)
      rebuildRemoteEgressOmittedParentsForTesting()
      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.size).toBeLessThanOrEqual(MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE)
      expect(map.has(lastListing)).toBe(true)
      const projected = projectTranscriptParentForExternalEgress(
        { parentUuid: lastListing },
        map,
      )
      expect(projected.parentUuid).toBe(userUuid)
      expect(JSON.stringify([...map.entries()])).not.toContain(
        'REBUILD-BOUND-LEAK',
      )
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

  test('ancestry-closure rematches a first post-resume child of O2 when O1 and O2 sit on opposite sides of OMISSION_REBUILD_TAIL_BYTES', async () => {
    process.env.USER_TYPE = 'external'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(
      join(tmpdir(), 'openclaude-egress-rebuild-o1-o2-'),
    )
    const path = join(dir, 'session.jsonl')
    const userUuid = id(40)
    const listingO1 = id(41)
    const listingO2 = id(42)
    const afterUuid = id(43)
    const remotePayloads: Array<Record<string, unknown>> = []
    try {
      const prefix =
        [
          JSON.stringify(user(userUuid, null, 'consecutive omission resume')),
          JSON.stringify(
            listing(listingO1, userUuid, 'skill_listing', 'O1-LEAK'),
          ),
        ].join('\n') + '\n'
      const snapshotPad = 's'.repeat(900)
      const snapshotLines: string[] = []
      let snapshotBytes = 0
      let i = 0
      while (snapshotBytes <= OMISSION_REBUILD_TAIL_BYTES) {
        const line =
          JSON.stringify({
            type: 'file-history-snapshot',
            messageId: id(2100 + i),
            snapshot: { pad: snapshotPad, i },
            isSnapshotUpdate: false,
          }) + '\n'
        snapshotLines.push(line)
        snapshotBytes += Buffer.byteLength(line)
        i += 1
      }
      const suffix =
        JSON.stringify(
          listing(listingO2, listingO1, 'skill_listing', 'O2-LEAK'),
        ) + '\n'
      await writeFile(path, prefix + snapshotLines.join('') + suffix)
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)
      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })
      rebuildRemoteEgressOmittedParentsForTesting()
      expect(getRemoteEgressOmissionRebuildIncompleteForTesting()).toBe(false)
      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.has(listingO2)).toBe(true)

      const afterMsg = {
        type: 'user',
        uuid: afterUuid,
        parentUuid: listingO2,
        timestamp: '2026-08-11T00:00:01.000Z',
        message: { role: 'user', content: 'first post-resume child of O2' },
      } as unknown as Message
      await recordTranscript([afterMsg], undefined, listingO2)
      await flushSessionStorage()

      const remoteAfter = remotePayloads.find(p => p.uuid === afterUuid)
      expect(remoteAfter).toBeDefined()
      expect(remoteAfter?.parentUuid).toBe(userUuid)
      const dumped = JSON.stringify(remotePayloads)
      expect(dumped).not.toContain('O1-LEAK')
      expect(dumped).not.toContain('O2-LEAK')
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
      // Retain omitted parents after the first safe child so branch siblings
      // can still reparent (P1: retain-omitted-parent-for-branch-children).
      expect(map.has(hookUuid)).toBe(true)

      const remoteAfter = remotePayloads.find(p => p.uuid === afterUuid)
      expect(remoteAfter).toBeDefined()
      expect(remoteAfter?.parentUuid).toBe(userUuid)
      expect(JSON.stringify(remotePayloads)).not.toContain('HOOK-APPEND-LEAK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('keeps omitted parent for a second branch child after the first reparents', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-branch-'))
    const path = join(dir, 'session.jsonl')
    const userUuid = id(30)
    const hookUuid = id(31)
    const childA = id(32)
    const childB = id(33)
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
      const hookMsg = {
        type: 'attachment',
        uuid: hookUuid,
        parentUuid: userUuid,
        timestamp: '2026-08-11T00:00:01.000Z',
        attachment: {
          type: 'hook_additional_context',
          content: 'BRANCH-LEAK',
          hookName: 'SessionStart',
          toolName: 'SessionStart',
          hookEvent: 'SessionStart',
          stdout: 'BRANCH-LEAK',
          stderr: '',
          exitCode: 0,
        },
      } as unknown as Message
      const afterA = {
        type: 'user',
        uuid: childA,
        parentUuid: hookUuid,
        timestamp: '2026-08-11T00:00:02.000Z',
        message: { role: 'user', content: 'branch A' },
      } as unknown as Message
      const afterB = {
        type: 'user',
        uuid: childB,
        parentUuid: hookUuid,
        timestamp: '2026-08-11T00:00:03.000Z',
        message: { role: 'user', content: 'branch B' },
      } as unknown as Message

      await recordTranscript([seedUser])
      await flushSessionStorage()
      remotePayloads.length = 0

      await recordTranscript([hookMsg, afterA], undefined, userUuid)
      await flushSessionStorage()
      expect(getRemoteEgressOmittedParentsForTesting().has(hookUuid)).toBe(true)

      await recordTranscript([afterB], undefined, hookUuid)
      await flushSessionStorage()

      const remoteA = remotePayloads.find(p => p.uuid === childA)
      const remoteB = remotePayloads.find(p => p.uuid === childB)
      expect(remoteA?.parentUuid).toBe(userUuid)
      expect(remoteB?.parentUuid).toBe(userUuid)
      expect(JSON.stringify(remotePayloads)).not.toContain('BRANCH-LEAK')
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

  test('compact ancestry reparents a child to the actual ancestor after a later sibling updates lastRemoteEgressUuid', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const omissionCount = MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE + 16
    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-sibling-'))
    const path = join(dir, 'session.jsonl')
    const userUuid = id(600)
    const firstListing = id(601)
    const siblingUuid = id(800)
    const childUuid = id(801)
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
        const uuid = id(601 + n)
        listings.push({
          type: 'attachment',
          uuid,
          parentUuid: parent,
          timestamp: `2026-08-11T00:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`,
          attachment: {
            type: 'hook_additional_context',
            content: `SIBLING-LEAK-${n}`,
            hookName: 'SessionStart',
            toolName: 'SessionStart',
            hookEvent: 'SessionStart',
            stdout: `SIBLING-LEAK-${n}`,
            stderr: '',
            exitCode: 0,
          },
        } as unknown as Message)
        parent = uuid
      }
      await recordTranscript(listings, undefined, userUuid)
      await flushSessionStorage()

      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.has(firstListing)).toBe(false)

      const sibling = {
        type: 'user',
        uuid: siblingUuid,
        parentUuid: userUuid,
        timestamp: '2026-08-11T00:02:00.000Z',
        message: { role: 'user', content: 'later sibling of compacted omission' },
      } as unknown as Message
      await recordTranscript([sibling], undefined, userUuid)
      await flushSessionStorage()

      const remoteSibling = remotePayloads.find(p => p.uuid === siblingUuid)
      expect(remoteSibling?.parentUuid).toBe(userUuid)

      const child = {
        type: 'user',
        uuid: childUuid,
        parentUuid: firstListing,
        timestamp: '2026-08-11T00:02:01.000Z',
        message: { role: 'user', content: 'child of compacted omission' },
      } as unknown as Message
      await recordTranscript([child], undefined, firstListing)
      await flushSessionStorage()

      const remoteChild = remotePayloads.find(p => p.uuid === childUuid)
      expect(remoteChild).toBeDefined()
      expect(remoteChild?.parentUuid).toBe(userUuid)
      expect(remoteChild?.parentUuid).not.toBe(siblingUuid)
      expect(remoteChild?.parentUuid).not.toBe(firstListing)
      expect(JSON.stringify(remotePayloads)).not.toContain('SIBLING-LEAK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('on-demand ancestry reparents a child after compact eviction and a later sibling persist', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const omissionCount = MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE * 2 + 2
    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-ondemand-'))
    const path = join(dir, 'session.jsonl')
    const userUuid = id(900)
    const firstListing = id(901)
    const siblingUuid = id(1100)
    const childUuid = id(1101)
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
        const uuid = id(901 + n)
        listings.push({
          type: 'attachment',
          uuid,
          parentUuid: parent,
          timestamp: `2026-08-11T00:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`,
          attachment: {
            type: 'hook_additional_context',
            content: `ONDEMAND-LEAK-${n}`,
            hookName: 'SessionStart',
            toolName: 'SessionStart',
            hookEvent: 'SessionStart',
            stdout: `ONDEMAND-LEAK-${n}`,
            stderr: '',
            exitCode: 0,
          },
        } as unknown as Message)
        parent = uuid
      }
      await recordTranscript(listings, undefined, userUuid)
      await flushSessionStorage()

      // Push firstListing outside the first tail window so the on-demand
      // resolver cannot succeed from a head read or a single tail slice.
      await appendFile(
        path,
        Buffer.concat([
          Buffer.from('\n'),
          Buffer.alloc(OMISSION_REBUILD_TAIL_BYTES + 1, 0x78),
          Buffer.from('\n'),
        ]),
      )

      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.has(firstListing)).toBe(false)
      // Documents that 130 omissions exceed MAX*2 and drop firstListing
      // from both bounded maps; not a file-size assertion.
      expect(omissionCount).toBeGreaterThan(129)

      const sibling = {
        type: 'user',
        uuid: siblingUuid,
        parentUuid: userUuid,
        timestamp: '2026-08-11T00:03:00.000Z',
        message: { role: 'user', content: 'later sibling after compact eviction' },
      } as unknown as Message
      await recordTranscript([sibling], undefined, userUuid)
      await flushSessionStorage()

      const child = {
        type: 'user',
        uuid: childUuid,
        parentUuid: firstListing,
        timestamp: '2026-08-11T00:03:01.000Z',
        message: { role: 'user', content: 'child after compact eviction' },
      } as unknown as Message
      await recordTranscript([child], undefined, firstListing)
      await flushSessionStorage()

      const remoteChild = remotePayloads.find(p => p.uuid === childUuid)
      expect(remoteChild).toBeDefined()
      expect(remoteChild?.parentUuid).toBe(userUuid)
      expect(remoteChild?.parentUuid).not.toBe(siblingUuid)
      expect(remoteChild?.parentUuid).not.toBe(firstListing)
      expect(JSON.stringify(remotePayloads)).not.toContain('ONDEMAND-LEAK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('incomplete rebuild fail-closes remote persist for unresolved parents', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-incomplete-'))
    const path = join(dir, 'session.jsonl')
    const withheldParent = id(400)
    const childUuid = id(401)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      // Oversized pad with no newlines → mid-line skip → incomplete rebuild.
      await writeFile(path, Buffer.alloc(OMISSION_REBUILD_TAIL_BYTES + 4096, 0x78))
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)
      await rebuildRemoteEgressOmittedParentsForTesting()
      expect(getRemoteEgressOmissionRebuildIncompleteForTesting()).toBe(true)

      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      const child = {
        type: 'user',
        uuid: childUuid,
        parentUuid: withheldParent,
        timestamp: '2026-08-11T00:04:00.000Z',
        message: { role: 'user', content: 'child under incomplete rebuild' },
      } as unknown as Message
      await recordTranscript([child], undefined, withheldParent)
      await flushSessionStorage()

      expect(remotePayloads.find(p => p.uuid === childUuid)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('incomplete persist skip records suppressed UUID so grandchildren rematch', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-grandchild-'))
    const path = join(dir, 'session.jsonl')
    const seedUuid = id(420)
    const withheldParent = id(421)
    const midUuid = id(422)
    const grandchildUuid = id(423)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      await writeFile(path, Buffer.alloc(OMISSION_REBUILD_TAIL_BYTES + 4096, 0x78))
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)
      await rebuildRemoteEgressOmittedParentsForTesting()
      expect(getRemoteEgressOmissionRebuildIncompleteForTesting()).toBe(true)

      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      const seed = {
        type: 'user',
        uuid: seedUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:05:00.000Z',
        message: { role: 'user', content: 'seed before suppressed mid' },
      } as unknown as Message
      await recordTranscript([seed], undefined, null)
      await flushSessionStorage()
      expect(remotePayloads.find(p => p.uuid === seedUuid)).toBeDefined()

      const mid = {
        type: 'user',
        uuid: midUuid,
        parentUuid: withheldParent,
        timestamp: '2026-08-11T00:05:01.000Z',
        message: { role: 'user', content: 'mid under withheld parent' },
      } as unknown as Message
      await recordTranscript([mid], undefined, withheldParent)
      await flushSessionStorage()

      expect(remotePayloads.find(p => p.uuid === midUuid)).toBeUndefined()
      expect(getRemoteEgressOmittedParentsForTesting().has(midUuid)).toBe(true)

      const grandchild = {
        type: 'user',
        uuid: grandchildUuid,
        parentUuid: midUuid,
        timestamp: '2026-08-11T00:05:02.000Z',
        message: { role: 'user', content: 'grandchild of suppressed mid' },
      } as unknown as Message
      await recordTranscript([grandchild], undefined, midUuid)
      await flushSessionStorage()

      const remoteGrandchild = remotePayloads.find(
        p => p.uuid === grandchildUuid,
      )
      expect(remoteGrandchild?.parentUuid).not.toBe(midUuid)
      expect(getRemoteEgressOmittedParentsForTesting().has(midUuid)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('incomplete rebuild fail-closes an unsafe chain when the scan budget is exhausted', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(
      join(tmpdir(), 'openclaude-egress-incomplete-span-'),
    )
    const path = join(dir, 'session.jsonl')
    const userUuid = id(410)
    const listingO1 = id(411)
    const listingO2 = id(412)
    const childUuid = id(413)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      const prefix =
        [
          JSON.stringify(user(userUuid, null, 'scan-cap prefix')),
          JSON.stringify(
            listing(listingO1, userUuid, 'skill_listing', 'SPAN-O1-LEAK'),
          ),
        ].join('\n') + '\n'
      const scanBudget = 8 * 1024
      const padSize = scanBudget + 1024
      const line = Buffer.alloc(80, 0x78)
      line[79] = 0x0a
      const pad = Buffer.allocUnsafe(padSize)
      for (let off = 0; off < padSize; off += 80) {
        line.copy(pad, off, 0, Math.min(80, padSize - off))
      }
      const suffix =
        JSON.stringify(
          listing(listingO2, listingO1, 'skill_listing', 'SPAN-O2-LEAK'),
        ) + '\n'
      await writeFile(
        path,
        Buffer.concat([Buffer.from(prefix, 'utf8'), pad, Buffer.from(suffix)]),
      )
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)
      await rebuildRemoteEgressOmittedParentsForTesting(scanBudget)
      expect(getRemoteEgressOmissionRebuildIncompleteForTesting()).toBe(true)

      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      const child = {
        type: 'user',
        uuid: childUuid,
        parentUuid: listingO2,
        timestamp: '2026-08-11T00:04:10.000Z',
        message: { role: 'user', content: 'child of O2 past scan cap' },
      } as unknown as Message
      await recordTranscript([child], undefined, listingO2)
      await flushSessionStorage()

      expect(remotePayloads.find(p => p.uuid === childUuid)).toBeUndefined()
      expect(JSON.stringify(remotePayloads)).not.toContain('SPAN-O1-LEAK')
      expect(JSON.stringify(remotePayloads)).not.toContain('SPAN-O2-LEAK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('compact fallback sees queued writes before flush', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-queued-'))
    const path = join(dir, 'session.jsonl')
    const userUuid = id(500)
    const firstListing = id(501)
    const childUuid = id(700)
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
        timestamp: '2026-08-11T00:05:00.000Z',
        message: { role: 'user', content: 'seed' },
      } as unknown as Message
      await recordTranscript([seedUser])
      await flushSessionStorage()
      remotePayloads.length = 0

      // One batch: many omissions (evict firstListing) + child of firstListing
      // without an intermediate flush so the queue still holds parents.
      const batch: Message[] = []
      let parent: UUID = userUuid
      for (let n = 0; n < MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE * 2 + 2; n++) {
        const uuid = id(501 + n)
        batch.push({
          type: 'attachment',
          uuid,
          parentUuid: parent,
          timestamp: `2026-08-11T00:05:00.${String(n).padStart(3, '0')}Z`,
          attachment: {
            type: 'hook_additional_context',
            content: 'QUEUED-LEAK',
            hookName: 'SessionStart',
            toolName: 'SessionStart',
            hookEvent: 'SessionStart',
            stdout: 'QUEUED-LEAK',
            stderr: '',
            exitCode: 0,
          },
        } as unknown as Message)
        parent = uuid
      }
      batch.push({
        type: 'user',
        uuid: childUuid,
        parentUuid: firstListing,
        timestamp: '2026-08-11T00:06:00.000Z',
        message: { role: 'user', content: 'child while queue pending' },
      } as unknown as Message)

      await recordTranscript(batch, undefined, userUuid)
      await flushSessionStorage()

      const map = getRemoteEgressOmittedParentsForTesting()
      expect(map.has(firstListing)).toBe(false)
      const remoteChild = remotePayloads.find(p => p.uuid === childUuid)
      expect(remoteChild).toBeDefined()
      expect(remoteChild?.parentUuid).toBe(userUuid)
      expect(JSON.stringify(remotePayloads)).not.toContain('QUEUED-LEAK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
