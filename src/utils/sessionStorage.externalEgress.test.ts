import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { UUID } from 'crypto'
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sessionIngress from '../services/api/sessionIngress.js'
import * as gracefulShutdownModule from '../utils/gracefulShutdown.js'
import {
  isSessionPersistenceDisabled,
  setSessionPersistenceDisabled,
} from '../bootstrap/state.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import type { Entry, TranscriptMessage } from '../types/logs.js'
import type { Message } from '../types/message.js'
import {
  clearSessionMessagesCache,
  filterJsonlForExternalEgress,
  filterMessagesForExternalEgress,
  filterSubagentTranscriptsForExternalEgress,
  flushSessionStorage,
  getRemoteEgressOmittedParentsForTesting,
  getRemoteEgressOmissionRebuildIncompleteForTesting,
  isMalformedAttachmentBearingEgressRecord,
  isSafeForExternalEgress,
  shouldOmitFromExternalEgress,
  EXTERNAL_EGRESS_LISTING_ATTACHMENT_TYPES,
  MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE,
  OMISSION_REBUILD_TAIL_BYTES,
  projectTranscriptParentForExternalEgress,
  rebuildRemoteEgressOmittedParentsForTesting,
  recordExternalEgressOmission,
  recordTranscript,
  resetProjectForTesting,
  setInternalEventWriter,
  setRemoteIngressUrlForTesting,
  setSessionFileForTesting,
} from './sessionStorage.js'

let snapshotUserType: string | undefined
let snapshotHookSave: string | undefined
let snapshotEnablePersist: string | undefined
let snapshotTestPersist: string | undefined
let snapshotNodeEnv: string | undefined
let snapshotSkipHistory: string | undefined
let snapshotSessionPersistenceDisabled: boolean
let ownsSharedMutationLock = false

beforeEach(async () => {
  ownsSharedMutationLock = false
  await acquireSharedMutationLock('utils/sessionStorage.externalEgress.test.ts')
  ownsSharedMutationLock = true

  // Capture mutable baseline only after acquiring the shared mutation lock
  snapshotUserType = process.env.USER_TYPE
  snapshotHookSave = process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT
  snapshotEnablePersist = process.env.ENABLE_SESSION_PERSISTENCE
  snapshotTestPersist = process.env.TEST_ENABLE_SESSION_PERSISTENCE
  snapshotNodeEnv = process.env.NODE_ENV
  snapshotSkipHistory = process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
  snapshotSessionPersistenceDisabled = isSessionPersistenceDisabled()
})

afterEach(() => {
  try {
    if (snapshotUserType === undefined) {
      delete process.env.USER_TYPE
    } else {
      process.env.USER_TYPE = snapshotUserType
    }
    if (snapshotHookSave === undefined) {
      delete process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT
    } else {
      process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = snapshotHookSave
    }
    if (snapshotEnablePersist === undefined) {
      delete process.env.ENABLE_SESSION_PERSISTENCE
    } else {
      process.env.ENABLE_SESSION_PERSISTENCE = snapshotEnablePersist
    }
    if (snapshotTestPersist === undefined) {
      delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
    } else {
      process.env.TEST_ENABLE_SESSION_PERSISTENCE = snapshotTestPersist
    }
    if (snapshotNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = snapshotNodeEnv
    }
    if (snapshotSkipHistory === undefined) {
      delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    } else {
      process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = snapshotSkipHistory
    }
    setSessionPersistenceDisabled(snapshotSessionPersistenceDisabled)
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
  const suiteBaseline = isSessionPersistenceDisabled()

  test('step1: append-style mutation leaves flag away from suite snapshot', () => {
    setSessionPersistenceDisabled(!suiteBaseline)
    expect(isSessionPersistenceDisabled()).not.toBe(suiteBaseline)
  })

  test('step2: afterEach restored the suite snapshot from step1', () => {
    expect(isSessionPersistenceDisabled()).toBe(suiteBaseline)
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
    expect(cyclic.parentUuid).toBeNull()
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
      // Assert: because userUuid was not delivered to the remote sink (no remote delivery witness),
      // afterMsg projects to the confirmed remote root (null), avoiding dangling pointers.
      expect(remoteAfter?.parentUuid).toBeNull()
      expect(remoteAfter?.parentUuid).not.toBe(listingUuid)
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
      // Assert: because userUuid was not delivered to the remote sink (no remote delivery witness),
      // afterMsg projects to the confirmed remote root (null), avoiding dangling pointers.
      expect(remoteAfter?.parentUuid).toBeNull()
      expect(remoteAfter?.parentUuid).not.toBe(listingO2)
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
      await recordTranscript([seed])
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

      // Incomplete rebuild stays true, so the grandchild takes the same
      // fail-closed persist skip as `mid` — assert that branch, not rematch
      // emit (optional parentUuid would pass when the payload is missing).
      expect(remotePayloads.find(p => p.uuid === grandchildUuid)).toBeUndefined()
      expect(
        getRemoteEgressOmittedParentsForTesting().has(grandchildUuid),
      ).toBe(true)
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

describe('external egress delivery failures, malformed records, and eviction fallback', () => {
  test('shouldOmitFromExternalEgress rejects malformed records, listings, and un-consented attachments', () => {
    process.env.USER_TYPE = 'external'
    delete process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT

    // Malformed records: attachment payload on non-attachment outer type
    expect(
      shouldOmitFromExternalEgress({
        type: 'user',
        attachment: { type: 'skill_listing', skills: ['bash'] },
      }),
    ).toBe(true)
    expect(
      shouldOmitFromExternalEgress({
        type: 'assistant',
        attachment: { type: 'some_tool' },
      }),
    ).toBe(true)

    // Listings
    for (const listingType of EXTERNAL_EGRESS_LISTING_ATTACHMENT_TYPES) {
      expect(
        shouldOmitFromExternalEgress({
          type: 'attachment',
          attachment: { type: listingType },
        }),
      ).toBe(true)
    }

    // Progress and hook context
    expect(
      shouldOmitFromExternalEgress({
        type: 'progress',
      }),
    ).toBe(true)
    expect(
      shouldOmitFromExternalEgress({
        type: 'attachment',
        attachment: { type: 'hook_additional_context' },
      }),
    ).toBe(true)

    // Safe records
    expect(
      shouldOmitFromExternalEgress({
        type: 'user',
      }),
    ).toBe(false)
    expect(
      shouldOmitFromExternalEgress({
        type: 'assistant',
      }),
    ).toBe(false)
  })

  test('P1-delivery: writer rejection on parent A omits A; child C reparents past A without dangling', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-p1-delivery-'))
    const path = join(dir, 'session.jsonl')
    const seedUuid = id(601)
    const parentA_Uuid = id(602)
    const listingB_Uuid = id(603)
    const childC_Uuid = id(604)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)

      setInternalEventWriter(async (_eventType, payload) => {
        if (payload.uuid === parentA_Uuid) {
          throw new Error('Simulated CCR writer transport failure for parent A')
        }
        remotePayloads.push(payload)
      })

      // 1. Deliver safe seed
      const seed = {
        type: 'user',
        uuid: seedUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:05:00.000Z',
        message: { role: 'user', content: 'seed message' },
      } as unknown as Message
      await recordTranscript([seed])
      await flushSessionStorage()
      expect(remotePayloads.find(p => p.uuid === seedUuid)).toBeDefined()

      // 2. Attempt parent A: writer rejects, so persistToRemote returns false
      // and A is recorded as omitted pointing to seedUuid (last confirmed tip).
      const parentA = {
        type: 'user',
        uuid: parentA_Uuid,
        parentUuid: seedUuid,
        timestamp: '2026-08-11T00:05:01.000Z',
        message: { role: 'user', content: 'parent A (fails write)' },
      } as unknown as Message
      await recordTranscript([parentA], undefined, seedUuid)
      await flushSessionStorage()
      expect(remotePayloads.find(p => p.uuid === parentA_Uuid)).toBeUndefined()
      expect(getRemoteEgressOmittedParentsForTesting().get(parentA_Uuid)).toBe(
        seedUuid,
      )

      // 3. Unsafe listing B is withheld by classifier and chained to parent A
      const listingB = {
        type: 'attachment',
        uuid: listingB_Uuid,
        parentUuid: parentA_Uuid,
        timestamp: '2026-08-11T00:05:02.000Z',
        attachment: {
          type: 'hook_additional_context',
          content: 'WITHHELD_HOOK_CONTENT',
          hookName: 'SessionStart',
          toolName: 'SessionStart',
          hookEvent: 'SessionStart',
          stdout: 'WITHHELD_HOOK_CONTENT',
          stderr: '',
          exitCode: 0,
        },
      } as unknown as Message
      await recordTranscript([listingB], undefined, parentA_Uuid)
      await flushSessionStorage()
      expect(remotePayloads.find(p => p.uuid === listingB_Uuid)).toBeUndefined()

      // 4. Safe child C (parented to listing B) is delivered.
      // Its parentUuid must be reparented past B and A to seedUuid!
      const childC = {
        type: 'user',
        uuid: childC_Uuid,
        parentUuid: listingB_Uuid,
        timestamp: '2026-08-11T00:05:03.000Z',
        message: { role: 'user', content: 'child C' },
      } as unknown as Message
      await recordTranscript([childC], undefined, listingB_Uuid)
      await flushSessionStorage()

      const remoteC = remotePayloads.find(p => p.uuid === childC_Uuid)
      expect(remoteC).toBeDefined()
      // Assert: C does NOT have dangling parentUuid pointing to unwritten A or B
      expect(remoteC?.parentUuid).toBe(seedUuid)
      expect(remoteC?.parentUuid).not.toBe(parentA_Uuid)
      expect(remoteC?.parentUuid).not.toBe(listingB_Uuid)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('P1-malformed: malformed attachment record on user message is blocked on live CCR persistence', async () => {
    process.env.USER_TYPE = 'external'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-p1-malformed-'))
    const path = join(dir, 'session.jsonl')
    const seedUuid = id(610)
    const malformedUuid = id(611)
    const childUuid = id(612)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)

      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      // 1. Deliver safe seed
      const seed = {
        type: 'user',
        uuid: seedUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:05:00.000Z',
        message: { role: 'user', content: 'seed message' },
      } as unknown as Message
      await recordTranscript([seed])
      await flushSessionStorage()

      // 2. Malformed record: outer type 'user' with attachment payload
      const malformed = {
        type: 'user',
        uuid: malformedUuid,
        parentUuid: seedUuid,
        timestamp: '2026-08-11T00:05:01.000Z',
        message: { role: 'user', content: 'malformed entry' },
        attachment: {
          type: 'skill_listing',
          skills: [{ name: 'SECRET_MALFORMED_SKILL' }],
        },
      } as unknown as Message
      await recordTranscript([malformed], undefined, seedUuid)
      await flushSessionStorage()

      // Assert: malformed record never reached remote
      expect(remotePayloads.find(p => p.uuid === malformedUuid)).toBeUndefined()
      expect(JSON.stringify(remotePayloads)).not.toContain(
        'SECRET_MALFORMED_SKILL',
      )
      // Assert: malformed entry was recorded in omission map
      expect(
        getRemoteEgressOmittedParentsForTesting().has(malformedUuid),
      ).toBe(true)

      // 3. Child of malformed entry reparents to seed
      const child = {
        type: 'user',
        uuid: childUuid,
        parentUuid: malformedUuid,
        timestamp: '2026-08-11T00:05:02.000Z',
        message: { role: 'user', content: 'child of malformed' },
      } as unknown as Message
      await recordTranscript([child], undefined, malformedUuid)
      await flushSessionStorage()

      const remoteChild = remotePayloads.find(p => p.uuid === childUuid)
      expect(remoteChild).toBeDefined()
      expect(remoteChild?.parentUuid).toBe(seedUuid)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('P2-eviction: child of historic withheld parent evicted past all tracking tiers resolves from local transcript', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-p2-eviction-'))
    const path = join(dir, 'session.jsonl')
    const seedUuid = id(700)
    const ancientWithheldUuid = id(701)
    const childUuid = id(799)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)

      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      // 1. Deliver seed
      const seed = {
        type: 'user',
        uuid: seedUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:05:00.000Z',
        message: { role: 'user', content: 'seed' },
      } as unknown as Message
      await recordTranscript([seed])
      await flushSessionStorage()

      // 2. Deliver ancient withheld parent (parented to seed)
      const ancientWithheld = {
        type: 'attachment',
        uuid: ancientWithheldUuid,
        parentUuid: seedUuid,
        timestamp: '2026-08-11T00:05:01.000Z',
        attachment: {
          type: 'hook_additional_context',
          content: 'ANCIENT-LEAK',
          hookName: 'SessionStart',
          toolName: 'SessionStart',
          hookEvent: 'SessionStart',
          stdout: 'ANCIENT-LEAK',
          stderr: '',
          exitCode: 0,
        },
      } as unknown as Message
      await recordTranscript([ancientWithheld], undefined, seedUuid)
      await flushSessionStorage()

      // 3. Flood with > 4 tiers of omissions (> 256) so ancientWithheldUuid
      // is evicted from:
      // - remoteEgressOmittedParents (Tier 1)
      // - evictedRemoteEgressOmissions (Tier 2)
      // - remoteEgressCompactAncestry (Tier 2)
      // - remoteEgressKnownOmitted (Tier 3)
      let prev = ancientWithheldUuid
      for (let n = 0; n < MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE * 4 + 10; n++) {
        const u = id(800 + n)
        const floodEntry = {
          type: 'attachment',
          uuid: u,
          parentUuid: prev,
          timestamp: `2026-08-11T00:05:02.${String(n % 1000).padStart(3, '0')}Z`,
          attachment: {
            type: 'hook_additional_context',
            content: 'FLOOD',
            hookName: 'SessionStart',
            toolName: 'SessionStart',
            hookEvent: 'SessionStart',
            stdout: 'FLOOD',
            stderr: '',
            exitCode: 0,
          },
        } as unknown as Message
        await recordTranscript([floodEntry], undefined, prev)
        prev = u
      }
      await flushSessionStorage()

      // Verify that ancientWithheldUuid is completely absent from Tier 1 map
      expect(
        getRemoteEgressOmittedParentsForTesting().has(ancientWithheldUuid),
      ).toBe(false)

      // 4. Send child of ancientWithheldUuid on a branching chain.
      // Because ancientWithheldUuid is absent from all 4 memory tiers, it must
      // resolve on-demand from the local transcript file to seedUuid.
      const child = {
        type: 'user',
        uuid: childUuid,
        parentUuid: ancientWithheldUuid,
        timestamp: '2026-08-11T00:06:00.000Z',
        message: { role: 'user', content: 'branch child of ancient withheld' },
      } as unknown as Message
      await recordTranscript([child], undefined, ancientWithheldUuid)
      await flushSessionStorage()

      const remoteChild = remotePayloads.find(p => p.uuid === childUuid)
      expect(remoteChild).toBeDefined()
      // Assert: child was reparented to seedUuid (nearest safe ancestor), NOT ancientWithheldUuid
      expect(remoteChild?.parentUuid).toBe(seedUuid)
      expect(remoteChild?.parentUuid).not.toBe(ancientWithheldUuid)
      expect(JSON.stringify(remotePayloads)).not.toContain('ANCIENT-LEAK')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 20000)

  test('P2-eviction without transcript: child of fully-evicted parent whose ancestry cannot be resolved fails closed', async () => {
    process.env.USER_TYPE = 'external'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(
      join(tmpdir(), 'openclaude-egress-p2-failclosed-'),
    )
    const path = join(dir, 'session.jsonl')
    const seedUuid = id(900)
    const unknownParentUuid = id(901) // Not in transcript
    const childUuid = id(902)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)

      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      // 1. Deliver seed
      const seed = {
        type: 'user',
        uuid: seedUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:05:00.000Z',
        message: { role: 'user', content: 'seed' },
      } as unknown as Message
      await recordTranscript([seed])
      await flushSessionStorage()

      // 2. Child references unknownParentUuid which does not exist in the local transcript
      // and is not in any omission map.
      const child = {
        type: 'user',
        uuid: childUuid,
        parentUuid: unknownParentUuid,
        timestamp: '2026-08-11T00:05:01.000Z',
        message: { role: 'user', content: 'child of unresolvable parent' },
      } as unknown as Message
      await recordTranscript([child], undefined, unknownParentUuid)
      await flushSessionStorage()

      // Assert: child fails closed and is NOT delivered with dangling reference
      expect(remotePayloads.find(p => p.uuid === childUuid)).toBeUndefined()
      // Assert: child itself was recorded in omission map for subsequent rematching
      expect(
        getRemoteEgressOmittedParentsForTesting().has(childUuid),
      ).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('P2-eviction: recursive compact ancestry resolution through chained omitted and evicted parents', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-p2-chain-'))
    const path = join(dir, 'session.jsonl')
    const seedUuid = id(1001)
    const withheldC_Uuid = id(1002)
    const withheldB_Uuid = id(1003)
    const childA_Uuid = id(1004)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)

      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      // 1. Deliver seed
      const seed = {
        type: 'user',
        uuid: seedUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:05:00.000Z',
        message: { role: 'user', content: 'seed' },
      } as unknown as Message
      await recordTranscript([seed])
      await flushSessionStorage()

      // 2. Deliver withheld C (parented to seed)
      const entryC = {
        type: 'attachment',
        uuid: withheldC_Uuid,
        parentUuid: seedUuid,
        timestamp: '2026-08-11T00:05:01.000Z',
        attachment: {
          type: 'hook_additional_context',
          content: 'LEAK-C',
          hookName: 'SessionStart',
          toolName: 'SessionStart',
          hookEvent: 'SessionStart',
          stdout: 'LEAK-C',
          stderr: '',
          exitCode: 0,
        },
      } as unknown as Message
      await recordTranscript([entryC], undefined, seedUuid)
      await flushSessionStorage()

      // 3. Flood > 64 items so C is evicted into remoteEgressCompactAncestry
      let prev = withheldC_Uuid
      for (let n = 0; n < MAX_REMOTE_EGRESS_OMISSION_MAP_SIZE + 5; n++) {
        const u = id(1100 + n)
        const floodEntry = {
          type: 'attachment',
          uuid: u,
          parentUuid: prev,
          timestamp: `2026-08-11T00:05:02.${String(n % 1000).padStart(3, '0')}Z`,
          attachment: {
            type: 'hook_additional_context',
            content: 'FLOOD',
            hookName: 'SessionStart',
            toolName: 'SessionStart',
            hookEvent: 'SessionStart',
            stdout: 'FLOOD',
            stderr: '',
            exitCode: 0,
          },
        } as unknown as Message
        await recordTranscript([floodEntry], undefined, prev)
        prev = u
      }
      await flushSessionStorage()

      // Verify C was evicted from Tier 1
      expect(
        getRemoteEgressOmittedParentsForTesting().has(withheldC_Uuid),
      ).toBe(false)

      // 4. Send withheld B parented to evicted C
      const entryB = {
        type: 'attachment',
        uuid: withheldB_Uuid,
        parentUuid: withheldC_Uuid,
        timestamp: '2026-08-11T00:05:03.000Z',
        attachment: {
          type: 'hook_additional_context',
          content: 'LEAK-B',
          hookName: 'SessionStart',
          toolName: 'SessionStart',
          hookEvent: 'SessionStart',
          stdout: 'LEAK-B',
          stderr: '',
          exitCode: 0,
        },
      } as unknown as Message
      await recordTranscript([entryB], undefined, withheldC_Uuid)
      await flushSessionStorage()

      // 5. Send safe child A parented to withheld B
      const entryA = {
        type: 'user',
        uuid: childA_Uuid,
        parentUuid: withheldB_Uuid,
        timestamp: '2026-08-11T00:06:00.000Z',
        message: { role: 'user', content: 'safe child A' },
      } as unknown as Message
      await recordTranscript([entryA], undefined, withheldB_Uuid)
      await flushSessionStorage()

      const remoteA = remotePayloads.find(p => p.uuid === childA_Uuid)
      expect(remoteA).toBeDefined()
      // Assert: A reparented all the way through B and evicted C to seedUuid
      expect(remoteA?.parentUuid).toBe(seedUuid)
      expect(remoteA?.parentUuid).not.toBe(withheldB_Uuid)
      expect(remoteA?.parentUuid).not.toBe(withheldC_Uuid)
      expect(JSON.stringify(remotePayloads)).not.toContain('LEAK-B')
      expect(JSON.stringify(remotePayloads)).not.toContain('LEAK-C')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('v1 session ingress: appendSessionLog promise rejection is caught and records omission', async () => {
    process.env.USER_TYPE = 'external'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-v1-reject-'))
    const path = join(dir, 'session.jsonl')
    const seedUuid = id(1201)
    const failedUuid = id(1202)
    const childUuid = id(1203)

    const shutdownSpy = spyOn(
      gracefulShutdownModule,
      'gracefulShutdownSync',
    ).mockImplementation(() => {})

    const appendSpy = spyOn(
      sessionIngress,
      'appendSessionLog',
    ).mockImplementation(async (_sessionId, entry) => {
      if (entry.uuid === failedUuid) {
        throw new Error('Simulated network connection reset in v1 ingress')
      }
      return true
    })

    try {
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)
      setRemoteIngressUrlForTesting('https://mock-ingress.anthropic.com/api/v1')

      // 1. Deliver seed
      const seed = {
        type: 'user',
        uuid: seedUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:05:00.000Z',
        message: { role: 'user', content: 'seed' },
      } as unknown as Message
      await recordTranscript([seed])
      await flushSessionStorage()

      // 2. Send failed message: appendSessionLog throws, persistToRemote catches and returns false
      const failedEntry = {
        type: 'user',
        uuid: failedUuid,
        parentUuid: seedUuid,
        timestamp: '2026-08-11T00:05:01.000Z',
        message: { role: 'user', content: 'entry that throws during v1 append' },
      } as unknown as Message
      await recordTranscript([failedEntry], undefined, seedUuid)
      await flushSessionStorage()

      // Assert: failedEntry is caught and recorded in omission map pointing to seedUuid
      expect(
        getRemoteEgressOmittedParentsForTesting().get(failedUuid),
      ).toBe(seedUuid)

      // 3. Child of failedEntry reparents past failed entry to seedUuid and is successfully sent
      const childEntry = {
        type: 'user',
        uuid: childUuid,
        parentUuid: failedUuid,
        timestamp: '2026-08-11T00:05:02.000Z',
        message: { role: 'user', content: 'child of failed entry' },
      } as unknown as Message
      await recordTranscript([childEntry], undefined, failedUuid)
      await flushSessionStorage()

      const childCall = appendSpy.mock.calls.find(
        args => (args[1] as TranscriptMessage).uuid === childUuid,
      )
      expect(childCall).toBeDefined()
      expect((childCall?.[1] as TranscriptMessage).parentUuid).toBe(seedUuid)
    } finally {
      shutdownSpy.mockRestore()
      appendSpy.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('root-level omitted first entry projects child to safe root with parentUuid null', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-root-omit-'))
    const path = join(dir, 'session.jsonl')
    const omittedRootUuid = id(1301)
    const childUuid = id(1302)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)

      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      // 1. Deliver root-level withheld entry (parentUuid is null)
      const withheldRoot = {
        type: 'attachment',
        uuid: omittedRootUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:05:00.000Z',
        attachment: {
          type: 'hook_additional_context',
          content: 'ROOT-LEAK',
          hookName: 'SessionStart',
          toolName: 'SessionStart',
          hookEvent: 'SessionStart',
          stdout: 'ROOT-LEAK',
          stderr: '',
          exitCode: 0,
        },
      } as unknown as Message
      await recordTranscript([withheldRoot])
      await flushSessionStorage()

      // Assert withheld root was omitted from remote payloads
      expect(remotePayloads.find(p => p.uuid === omittedRootUuid)).toBeUndefined()
      expect(getRemoteEgressOmittedParentsForTesting().get(omittedRootUuid)).toBeNull()

      // 2. Deliver safe child whose parent is the omitted root
      const child = {
        type: 'user',
        uuid: childUuid,
        parentUuid: omittedRootUuid,
        timestamp: '2026-08-11T00:05:01.000Z',
        message: { role: 'user', content: 'child of omitted root' },
      } as unknown as Message
      await recordTranscript([child], undefined, omittedRootUuid)
      await flushSessionStorage()

      // Assert child was delivered as a root message with parentUuid: null
      const remoteChild = remotePayloads.find(p => p.uuid === childUuid)
      expect(remoteChild).toBeDefined()
      expect(remoteChild?.parentUuid).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('no-sink-to-sink: safe parent written before sink is not a remote delivery witness', async () => {
    process.env.USER_TYPE = 'external'
    process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT = '1'
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-no-sink-'))
    const path = join(dir, 'session.jsonl')
    const preSinkSafeUuid = id(1401)
    const omittedUuid = id(1402)
    const postSinkSafeUuid = id(1403)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)

      // 1. Record safe A with NO remote sink registered
      const preSinkSafe = {
        type: 'user',
        uuid: preSinkSafeUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:05:00.000Z',
        message: { role: 'user', content: 'written before sink installed' },
      } as unknown as Message
      await recordTranscript([preSinkSafe])
      await flushSessionStorage()

      // 2. Install remote sink
      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      // 3. Record omitted L (parented to preSinkSafeUuid)
      const omitted = {
        type: 'attachment',
        uuid: omittedUuid,
        parentUuid: preSinkSafeUuid,
        timestamp: '2026-08-11T00:05:01.000Z',
        attachment: {
          type: 'hook_additional_context',
          content: 'WITHHELD',
          hookName: 'SessionStart',
          toolName: 'SessionStart',
          hookEvent: 'SessionStart',
          stdout: 'WITHHELD',
          stderr: '',
          exitCode: 0,
        },
      } as unknown as Message
      await recordTranscript([omitted], undefined, preSinkSafeUuid)
      await flushSessionStorage()

      // 4. Record safe C (parented to omittedUuid)
      const postSinkSafe = {
        type: 'user',
        uuid: postSinkSafeUuid,
        parentUuid: omittedUuid,
        timestamp: '2026-08-11T00:05:02.000Z',
        message: { role: 'user', content: 'first safe entry after sink' },
      } as unknown as Message
      await recordTranscript([postSinkSafe], undefined, omittedUuid)
      await flushSessionStorage()

      // Assert: C was delivered
      const remoteC = remotePayloads.find(p => p.uuid === postSinkSafeUuid)
      expect(remoteC).toBeDefined()
      // Assert: C was projected to null root (because preSinkSafeUuid was never delivered remotely!)
      expect(remoteC?.parentUuid).toBeNull()
      expect(remoteC?.parentUuid).not.toBe(preSinkSafeUuid)
      expect(remoteC?.parentUuid).not.toBe(omittedUuid)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('malformed attachment envelope on ant path is fail-closed', async () => {
    process.env.USER_TYPE = 'ant'
    delete process.env.CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT

    // Schema checks: non-object attachment, null type, missing type, non-string type, empty type
    expect(
      shouldOmitFromExternalEgress({
        type: 'attachment',
        attachment: { type: null, content: 'malformed-ant-leak' },
      }),
    ).toBe(true)

    expect(
      shouldOmitFromExternalEgress({
        type: 'attachment',
        attachment: {},
      }),
    ).toBe(true)

    expect(
      shouldOmitFromExternalEgress({
        type: 'attachment',
        attachment: { type: 42 },
      }),
    ).toBe(true)

    expect(
      shouldOmitFromExternalEgress({
        type: 'attachment',
        attachment: { type: '' },
      }),
    ).toBe(true)

    expect(
      shouldOmitFromExternalEgress({
        type: 'attachment',
        attachment: null,
      }),
    ).toBe(true)

    expect(
      shouldOmitFromExternalEgress({
        type: 'attachment',
      }),
    ).toBe(true)

    // Valid attachment for ant is allowed
    expect(
      shouldOmitFromExternalEgress({
        type: 'attachment',
        attachment: {
          type: 'hook_additional_context',
          content: 'valid-ant-hook',
        },
      }),
    ).toBe(false)

    // In live CCR persistence: malformed attachment under ant is blocked
    process.env.NODE_ENV = 'development'
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
    process.env.ENABLE_SESSION_PERSISTENCE = 'true'
    delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
    setSessionPersistenceDisabled(false)

    const dir = await mkdtemp(join(tmpdir(), 'openclaude-egress-ant-malformed-'))
    const path = join(dir, 'session.jsonl')
    const seedUuid = id(1501)
    const malformedUuid = id(1502)
    const childUuid = id(1503)
    const remotePayloads: Array<Record<string, unknown>> = []

    try {
      resetProjectForTesting()
      clearSessionMessagesCache()
      setSessionFileForTesting(path)

      setInternalEventWriter(async (_eventType, payload) => {
        remotePayloads.push(payload)
      })

      // 1. Deliver seed
      const seed = {
        type: 'user',
        uuid: seedUuid,
        parentUuid: null,
        timestamp: '2026-08-11T00:05:00.000Z',
        message: { role: 'user', content: 'seed' },
      } as unknown as Message
      await recordTranscript([seed])
      await flushSessionStorage()

      // 2. Deliver malformed attachment under ant
      const malformed = {
        type: 'attachment',
        uuid: malformedUuid,
        parentUuid: seedUuid,
        timestamp: '2026-08-11T00:05:01.000Z',
        attachment: {
          type: null,
          content: 'ANT-LEAK',
        },
      } as unknown as Message
      await recordTranscript([malformed], undefined, seedUuid)
      await flushSessionStorage()

      // Assert malformed entry was omitted from remote
      expect(remotePayloads.find(p => p.uuid === malformedUuid)).toBeUndefined()
      expect(JSON.stringify(remotePayloads)).not.toContain('ANT-LEAK')

      // 3. Child reparents past malformed entry to seed
      const child = {
        type: 'user',
        uuid: childUuid,
        parentUuid: malformedUuid,
        timestamp: '2026-08-11T00:05:02.000Z',
        message: { role: 'user', content: 'child of malformed' },
      } as unknown as Message
      await recordTranscript([child], undefined, malformedUuid)
      await flushSessionStorage()

      const remoteChild = remotePayloads.find(p => p.uuid === childUuid)
      expect(remoteChild).toBeDefined()
      expect(remoteChild?.parentUuid).toBe(seedUuid)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

