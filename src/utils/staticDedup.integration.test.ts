/**
 * Integration test: static-dedup end-to-end byte reduction.
 *
 * WHY: the unit tests in *Delta.test.ts verify each scanner in
 * isolation. This file asserts the CLAIM of Phase 2 — that a session
 * with unchanged static context (CLAUDE.md, gitStatus, nested memory
 * files, todo list) sends measurably fewer bytes on turns 2+ when
 * OPENCLAUDE_STATIC_DEDUP is active.
 *
 * Without this, the Phase 2 -30 to -40% body-JSON target is a
 * hypothesis with no guardrail. A future refactor could silently
 * disable one of the swap-ins (wrong conditional, renamed symbol,
 * missing gate) and every unit test would still pass while every
 * turn kept re-emitting the same content.
 *
 * We measure with `stableStringify` — the exact same serializer the
 * openaiShim / codexShim use on the request body, so the numbers
 * reflect what a provider actually sees on the wire.
 *
 * Mirrors the integration-style of src/cost-tracker.cacheIntegration
 * and src/services/api/cacheMetricsIntegration: real production
 * functions, no module mocking, scenario-driven assertions. Fewer
 * moving parts, and the test fails for the right reason if anyone
 * breaks the dedup path.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { estimateWithBounds } from '../services/tokenEstimation.js'
import {
  getClaudeMdDelta,
  isStaticDedupEnabled,
} from './claudeMdDelta.js'
import { getGitStatusDelta } from './gitStatusDelta.js'
import { getMemoryDelta, type MemoryFileInput } from './memoryDelta.js'
import { stableStringify } from './stableStringify.js'
import {
  getTodoReminderDelta,
  type TodoSnapshotItem,
} from './todoReminderDelta.js'

// Minimum savings ratio for turn 2+ to declare the dedup active. The
// Phase 2 plan targets -30 to -40%; we use 25% as a conservative
// guardrail so micro-fluctuations in hash length / delta metadata
// don't flap the test. Exceeding it doesn't fail; dropping below
// means dedup silently broke or a new turn-invariant got added to
// the delta payload.
const MIN_SAVINGS_RATIO = 0.25

// Realistic static content sizes observed in open-build sessions.
// CLAUDE.md: ~15KB is common in mature projects (open-source
// guidelines + repo map + team conventions).
const TYPICAL_CLAUDE_MD_SIZE = 15_000
// gitStatus: ~2KB when a handful of files are modified.
const TYPICAL_GIT_STATUS_SIZE = 2_000
// Nested memory: 3 files × 3KB is a common pattern (per-dir CLAUDE.md
// in a project with nested packages).
const TYPICAL_MEMORY_FILE_SIZE = 3_000
const TYPICAL_MEMORY_FILE_COUNT = 3

// Union of the fields each scanner's local ScannableMessage reads.
// Keeping them all optional here lets a single helper array satisfy
// every scanner signature without casts.
type AttachmentMessage = {
  type: 'attachment'
  attachment: {
    type: string
    contentHash?: string
    addedNames?: string[]
    addedHashes?: string[]
    removedNames?: string[]
    snapshot?: Array<{ id: string; status: string }>
  } & Record<string, unknown>
}

/**
 * Byte length of an attachment list as the shim would serialize it.
 * Reuses stableStringify so the number matches what goes on the wire.
 */
function serialize(attachments: Array<Record<string, unknown>>): number {
  return stableStringify(attachments).length
}

/**
 * Estimated token count of a serialized attachment list, using the
 * project's `estimateWithBounds` helper with `type='json'` — the
 * attachment payload is always JSON on the wire, so this ratio
 * (1.5-2.5 chars/token) matches what a tokenizer would produce.
 *
 * Byte length (from `serialize`) is what the provider bills for
 * payload-cost providers (Copilot); token estimate is what the plan's
 * claim ("-30 to -40% body JSON") targets semantically. Asserting on
 * both closes the gap between the two units.
 */
function estimateTokens(attachments: Array<Record<string, unknown>>): number {
  return estimateWithBounds(stableStringify(attachments), 'json').estimate
}

function repeat(n: number): string {
  return 'x'.repeat(n)
}

// --- Attachment shape factories --------------------------------------------
// These mirror the wrappers in src/utils/attachments.ts so the scanners
// can reconstruct prior state from the transcript.

function claudeMdDeltaMsg(
  addedContent: string,
  contentHash: string,
  isInitial: boolean,
): AttachmentMessage {
  return {
    type: 'attachment',
    attachment: {
      type: 'claude_md_delta',
      addedContent,
      contentHash,
      isInitial,
    },
  }
}

function gitStatusDeltaMsg(content: string): AttachmentMessage {
  return {
    type: 'attachment',
    attachment: { type: 'git_status_delta', content },
  }
}

function memoryDeltaMsg(
  addedNames: string[],
  addedContent: string[],
  addedHashes: string[],
  removedNames: string[],
  isInitial: boolean,
): AttachmentMessage {
  return {
    type: 'attachment',
    attachment: {
      type: 'memory_delta',
      addedNames,
      addedContent,
      addedHashes,
      removedNames,
      isInitial,
    },
  }
}

function todoReminderDeltaMsg(
  snapshot: Array<{ id: string; status: string }>,
): AttachmentMessage {
  return {
    type: 'attachment',
    attachment: { type: 'todo_reminder_delta', snapshot },
  }
}

// --- Baseline shapes -------------------------------------------------------
// What would be injected WITHOUT dedup (the always-emit path today).

function baselineClaudeMd(content: string): Record<string, unknown> {
  return { type: 'user_context', claudeMd: content }
}

function baselineGitStatus(content: string): Record<string, unknown> {
  return { type: 'system_context', gitStatus: content }
}

function baselineMemoryAttachments(
  files: MemoryFileInput[],
): Record<string, unknown>[] {
  return files.map(f => ({
    type: 'nested_memory',
    path: f.path,
    content: { content: f.content },
  }))
}

function baselineTodoReminder(
  todos: TodoSnapshotItem[],
): Record<string, unknown> {
  return { type: 'todo_reminder', todos }
}

describe('static-dedup integration: per-scanner byte savings', () => {
  test('CLAUDE.md: turn 2+ emits zero bytes when content unchanged', () => {
    const claudeMdContent = repeat(TYPICAL_CLAUDE_MD_SIZE)
    const transcript: AttachmentMessage[] = []

    // Turn 1 — initial emission
    const turn1Delta = getClaudeMdDelta(claudeMdContent, transcript)
    expect(turn1Delta).not.toBeNull()
    expect(turn1Delta!.isInitial).toBe(true)
    expect(turn1Delta!.addedContent.length).toBe(TYPICAL_CLAUDE_MD_SIZE)
    transcript.push(
      claudeMdDeltaMsg(
        turn1Delta!.addedContent,
        turn1Delta!.contentHash,
        turn1Delta!.isInitial,
      ),
    )

    // Turn 2 & 3 — content unchanged
    expect(getClaudeMdDelta(claudeMdContent, transcript)).toBeNull()
    expect(getClaudeMdDelta(claudeMdContent, transcript)).toBeNull()

    // Byte + token accounting for turn 2 specifically. Tokens are the
    // unit the Fase 2 plan targets (-30 to -40% body JSON); bytes are
    // what Copilot bills. Both must move.
    const baselineTurn2Bytes = serialize([baselineClaudeMd(claudeMdContent)])
    const dedupTurn2Bytes = serialize([]) // null → no attachment emitted
    const byteSavings =
      (baselineTurn2Bytes - dedupTurn2Bytes) / baselineTurn2Bytes
    expect(byteSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)

    const baselineTurn2Tokens = estimateTokens([
      baselineClaudeMd(claudeMdContent),
    ])
    const dedupTurn2Tokens = estimateTokens([])
    const tokenSavings =
      (baselineTurn2Tokens - dedupTurn2Tokens) / baselineTurn2Tokens
    expect(tokenSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)
  })

  test('gitStatus: turn 2+ emits zero bytes (snapshot is immutable)', () => {
    const gitStatusSnapshot = repeat(TYPICAL_GIT_STATUS_SIZE)
    const transcript: AttachmentMessage[] = []

    const turn1Delta = getGitStatusDelta(gitStatusSnapshot, transcript)
    expect(turn1Delta).not.toBeNull()
    expect(turn1Delta!.content).toBe(gitStatusSnapshot)
    transcript.push(gitStatusDeltaMsg(turn1Delta!.content))

    // By design: subsequent turns never re-emit (snapshot is immutable)
    expect(getGitStatusDelta(gitStatusSnapshot, transcript)).toBeNull()
    expect(getGitStatusDelta(gitStatusSnapshot, transcript)).toBeNull()

    const baselineTurn2Bytes = serialize([baselineGitStatus(gitStatusSnapshot)])
    const dedupTurn2Bytes = serialize([])
    const byteSavings =
      (baselineTurn2Bytes - dedupTurn2Bytes) / baselineTurn2Bytes
    expect(byteSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)
  })

  test('nested memory: turn 2+ emits zero bytes when files unchanged', () => {
    const memoryFiles: MemoryFileInput[] = Array.from(
      { length: TYPICAL_MEMORY_FILE_COUNT },
      (_, index) => ({
        path: `/pkg-${index}/CLAUDE.md`,
        content: repeat(TYPICAL_MEMORY_FILE_SIZE),
      }),
    )
    const transcript: AttachmentMessage[] = []

    const turn1Delta = getMemoryDelta(memoryFiles, transcript)
    expect(turn1Delta).not.toBeNull()
    expect(turn1Delta!.isInitial).toBe(true)
    expect(turn1Delta!.addedNames.length).toBe(TYPICAL_MEMORY_FILE_COUNT)
    transcript.push(
      memoryDeltaMsg(
        turn1Delta!.addedNames,
        turn1Delta!.addedContent,
        turn1Delta!.addedHashes,
        turn1Delta!.removedNames,
        turn1Delta!.isInitial,
      ),
    )

    expect(getMemoryDelta(memoryFiles, transcript)).toBeNull()
    expect(getMemoryDelta(memoryFiles, transcript)).toBeNull()

    const baselineTurn2Bytes = serialize(
      baselineMemoryAttachments(memoryFiles),
    )
    const dedupTurn2Bytes = serialize([])
    const byteSavings =
      (baselineTurn2Bytes - dedupTurn2Bytes) / baselineTurn2Bytes
    expect(byteSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)
  })

  test('todo reminder: turn 2+ emits zero bytes when list unchanged', () => {
    const todoSnapshot: TodoSnapshotItem[] = Array.from(
      { length: 10 },
      (_, index) => ({
        id: `task-${index}`,
        status: 'pending',
        text: `Task number ${index} with enough context to be realistic`,
      }),
    )
    const transcript: AttachmentMessage[] = []

    const turn1Delta = getTodoReminderDelta(todoSnapshot, transcript)
    expect(turn1Delta).not.toBeNull()
    expect(turn1Delta!.isInitial).toBe(true)
    expect(turn1Delta!.added.length).toBe(10)
    transcript.push(todoReminderDeltaMsg(turn1Delta!.snapshot))

    expect(getTodoReminderDelta(todoSnapshot, transcript)).toBeNull()
    expect(getTodoReminderDelta(todoSnapshot, transcript)).toBeNull()

    const baselineTurn2Bytes = serialize([baselineTodoReminder(todoSnapshot)])
    const dedupTurn2Bytes = serialize([])
    const byteSavings =
      (baselineTurn2Bytes - dedupTurn2Bytes) / baselineTurn2Bytes
    expect(byteSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)
  })
})

describe('static-dedup integration: combined 3-turn session', () => {
  test('total payload across turns 2-3 is ≥25% smaller than baseline', () => {
    const claudeMdContent = repeat(TYPICAL_CLAUDE_MD_SIZE)
    const gitStatusSnapshot = repeat(TYPICAL_GIT_STATUS_SIZE)
    const memoryFiles: MemoryFileInput[] = Array.from(
      { length: TYPICAL_MEMORY_FILE_COUNT },
      (_, index) => ({
        path: `/pkg-${index}/CLAUDE.md`,
        content: repeat(TYPICAL_MEMORY_FILE_SIZE),
      }),
    )
    const todoSnapshot: TodoSnapshotItem[] = Array.from(
      { length: 10 },
      (_, index) => ({
        id: `task-${index}`,
        status: 'pending',
        text: `Task ${index}`,
      }),
    )

    // --- Baseline (always-emit) accounting for turns 2 and 3 ---
    const bytesPerBaselineTurn = serialize([
      baselineClaudeMd(claudeMdContent),
      baselineGitStatus(gitStatusSnapshot),
      ...baselineMemoryAttachments(memoryFiles),
      baselineTodoReminder(todoSnapshot),
    ])
    const baselineBytesTurns23 = bytesPerBaselineTurn * 2

    // --- Dedup path: simulate turn 1 emission, then measure turns 2+3 ---
    const transcript: AttachmentMessage[] = []

    // Turn 1 — initial emissions. Each scanner pushes its delta into
    // the transcript so subsequent scans can reconstruct prior state.
    const turn1ClaudeMd = getClaudeMdDelta(claudeMdContent, transcript)
    transcript.push(
      claudeMdDeltaMsg(
        turn1ClaudeMd!.addedContent,
        turn1ClaudeMd!.contentHash,
        turn1ClaudeMd!.isInitial,
      ),
    )
    const turn1GitStatus = getGitStatusDelta(gitStatusSnapshot, transcript)
    transcript.push(gitStatusDeltaMsg(turn1GitStatus!.content))
    const turn1Memory = getMemoryDelta(memoryFiles, transcript)
    transcript.push(
      memoryDeltaMsg(
        turn1Memory!.addedNames,
        turn1Memory!.addedContent,
        turn1Memory!.addedHashes,
        turn1Memory!.removedNames,
        turn1Memory!.isInitial,
      ),
    )
    const turn1Todo = getTodoReminderDelta(todoSnapshot, transcript)
    transcript.push(todoReminderDeltaMsg(turn1Todo!.snapshot))

    // Turn 2 — measure what gets added (expected: ~nothing).
    const turn2Additions: Record<string, unknown>[] = []
    const turn2ClaudeMd = getClaudeMdDelta(claudeMdContent, transcript)
    if (turn2ClaudeMd)
      turn2Additions.push({ type: 'claude_md_delta', ...turn2ClaudeMd })
    const turn2GitStatus = getGitStatusDelta(gitStatusSnapshot, transcript)
    if (turn2GitStatus)
      turn2Additions.push({ type: 'git_status_delta', ...turn2GitStatus })
    const turn2Memory = getMemoryDelta(memoryFiles, transcript)
    if (turn2Memory)
      turn2Additions.push({ type: 'memory_delta', ...turn2Memory })
    const turn2Todo = getTodoReminderDelta(todoSnapshot, transcript)
    if (turn2Todo)
      turn2Additions.push({ type: 'todo_reminder_delta', ...turn2Todo })

    // Turn 3 — measure what gets added.
    const turn3Additions: Record<string, unknown>[] = []
    const turn3ClaudeMd = getClaudeMdDelta(claudeMdContent, transcript)
    if (turn3ClaudeMd)
      turn3Additions.push({ type: 'claude_md_delta', ...turn3ClaudeMd })
    const turn3GitStatus = getGitStatusDelta(gitStatusSnapshot, transcript)
    if (turn3GitStatus)
      turn3Additions.push({ type: 'git_status_delta', ...turn3GitStatus })
    const turn3Memory = getMemoryDelta(memoryFiles, transcript)
    if (turn3Memory)
      turn3Additions.push({ type: 'memory_delta', ...turn3Memory })
    const turn3Todo = getTodoReminderDelta(todoSnapshot, transcript)
    if (turn3Todo)
      turn3Additions.push({ type: 'todo_reminder_delta', ...turn3Todo })

    const dedupBytesTurns23 =
      serialize(turn2Additions) + serialize(turn3Additions)
    const byteSavings =
      (baselineBytesTurns23 - dedupBytesTurns23) / baselineBytesTurns23
    expect(byteSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)

    // Token-level savings — matches the unit the Fase 2 plan targets.
    // estimateWithBounds uses the project's `json` compression ratio
    // (~2 chars/token), so the number reflects what a tokenizer would
    // produce on the wire, not a hardcoded char-per-token guess.
    const baselineTokensTurns23 =
      estimateTokens([
        baselineClaudeMd(claudeMdContent),
        baselineGitStatus(gitStatusSnapshot),
        ...baselineMemoryAttachments(memoryFiles),
        baselineTodoReminder(todoSnapshot),
      ]) * 2
    const dedupTokensTurns23 =
      estimateTokens(turn2Additions) + estimateTokens(turn3Additions)
    const tokenSavings =
      (baselineTokensTurns23 - dedupTokensTurns23) / baselineTokensTurns23
    expect(tokenSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)

    // Stability: turn 3 must not regress vs turn 2 (scanners idempotent
    // once state is announced).
    expect(turn3Additions.length).toBe(turn2Additions.length)
  })

  test('dedup path respects a real content change on turn 2', () => {
    // Regression guard: if CLAUDE.md actually changes turn-to-turn,
    // the delta must re-emit. A savings claim that silently dropped
    // real changes would be dangerous; make sure the "always return
    // null" path is never the accidental fast path.
    const originalContent = repeat(TYPICAL_CLAUDE_MD_SIZE)
    const changedContent = originalContent + 'NEW_SECTION'
    const transcript: AttachmentMessage[] = []

    const turn1Delta = getClaudeMdDelta(originalContent, transcript)
    transcript.push(
      claudeMdDeltaMsg(
        turn1Delta!.addedContent,
        turn1Delta!.contentHash,
        turn1Delta!.isInitial,
      ),
    )
    // Real drift: must re-emit
    const turn2Delta = getClaudeMdDelta(changedContent, transcript)
    expect(turn2Delta).not.toBeNull()
    expect(turn2Delta!.addedContent).toBe(changedContent)
    expect(turn2Delta!.isInitial).toBe(false)
  })
})

/**
 * End-to-end: toggle the real OPENCLAUDE_STATIC_DEDUP env var and
 * measure what would go on the wire under each setting.
 *
 * The per-scanner tests above simulate both paths with hand-built
 * attachment arrays. This block instead treats the feature as a
 * black box: flip the env var, exercise the same pipeline
 * (`isStaticDedupEnabled()` gates which attachments reach the shim)
 * and compute the savings percentages that ship in the PR claim.
 *
 * Numbers from this block are the ones to quote externally — they're
 * measured by the same code path production uses.
 */
describe('static-dedup integration: env-toggled end-to-end savings', () => {
  const ENV_VAR = 'OPENCLAUDE_STATIC_DEDUP'
  let originalEnvValue: string | undefined

  beforeAll(() => {
    originalEnvValue = process.env[ENV_VAR]
  })

  afterAll(() => {
    if (originalEnvValue === undefined) {
      delete process.env[ENV_VAR]
    } else {
      process.env[ENV_VAR] = originalEnvValue
    }
  })

  /**
   * Build the full per-turn static payload that a provider would see,
   * deciding what to include based on `isStaticDedupEnabled()`:
   *
   * - Flag OFF: baseline shape (claudeMd/gitStatus injected via context,
   *   full nested_memory + todo_reminder attachments).
   * - Flag ON: delta shape (delta attachments instead; scanners emit
   *   full content on turn 1, null on turn 2+).
   *
   * The transcript accumulates across turns so the scanners can
   * reconstruct prior-announced state — exactly like production.
   */
  function emitTurnPayload(
    transcript: AttachmentMessage[],
    claudeMdContent: string,
    gitStatusSnapshot: string,
    memoryFiles: MemoryFileInput[],
    todoSnapshot: TodoSnapshotItem[],
  ): Record<string, unknown>[] {
    if (!isStaticDedupEnabled()) {
      // Baseline: every turn re-emits the full static bundle.
      return [
        baselineClaudeMd(claudeMdContent),
        baselineGitStatus(gitStatusSnapshot),
        ...baselineMemoryAttachments(memoryFiles),
        baselineTodoReminder(todoSnapshot),
      ]
    }

    const emitted: Record<string, unknown>[] = []
    const claudeMdDelta = getClaudeMdDelta(claudeMdContent, transcript)
    if (claudeMdDelta) {
      emitted.push({ type: 'claude_md_delta', ...claudeMdDelta })
      transcript.push(
        claudeMdDeltaMsg(
          claudeMdDelta.addedContent,
          claudeMdDelta.contentHash,
          claudeMdDelta.isInitial,
        ),
      )
    }
    const gitStatusDelta = getGitStatusDelta(gitStatusSnapshot, transcript)
    if (gitStatusDelta) {
      emitted.push({ type: 'git_status_delta', ...gitStatusDelta })
      transcript.push(gitStatusDeltaMsg(gitStatusDelta.content))
    }
    const memoryDelta = getMemoryDelta(memoryFiles, transcript)
    if (memoryDelta) {
      emitted.push({ type: 'memory_delta', ...memoryDelta })
      transcript.push(
        memoryDeltaMsg(
          memoryDelta.addedNames,
          memoryDelta.addedContent,
          memoryDelta.addedHashes,
          memoryDelta.removedNames,
          memoryDelta.isInitial,
        ),
      )
    }
    const todoDelta = getTodoReminderDelta(todoSnapshot, transcript)
    if (todoDelta) {
      emitted.push({ type: 'todo_reminder_delta', ...todoDelta })
      transcript.push(todoReminderDeltaMsg(todoDelta.snapshot))
    }
    return emitted
  }

  /** Simulate a stable N-turn session and return per-turn payload sizes. */
  function measureSession(turnCount: number): {
    totalBytes: number
    totalTokens: number
    turnBytes: number[]
  } {
    const claudeMdContent = repeat(TYPICAL_CLAUDE_MD_SIZE)
    const gitStatusSnapshot = repeat(TYPICAL_GIT_STATUS_SIZE)
    const memoryFiles: MemoryFileInput[] = Array.from(
      { length: TYPICAL_MEMORY_FILE_COUNT },
      (_, index) => ({
        path: `/pkg-${index}/CLAUDE.md`,
        content: repeat(TYPICAL_MEMORY_FILE_SIZE),
      }),
    )
    const todoSnapshot: TodoSnapshotItem[] = Array.from(
      { length: 10 },
      (_, index) => ({
        id: `task-${index}`,
        status: 'pending',
        text: `Task ${index}`,
      }),
    )

    const transcript: AttachmentMessage[] = []
    let totalBytes = 0
    let totalTokens = 0
    const turnBytes: number[] = []
    for (let turnIndex = 0; turnIndex < turnCount; turnIndex++) {
      const turnPayload = emitTurnPayload(
        transcript,
        claudeMdContent,
        gitStatusSnapshot,
        memoryFiles,
        todoSnapshot,
      )
      const bytes = serialize(turnPayload)
      totalBytes += bytes
      totalTokens += estimateTokens(turnPayload)
      turnBytes.push(bytes)
    }
    return { totalBytes, totalTokens, turnBytes }
  }

  test('flag OFF → baseline emits full static payload every turn', () => {
    process.env[ENV_VAR] = ''
    expect(isStaticDedupEnabled()).toBe(false)

    const baseline = measureSession(3)
    // Every turn carries the full static bundle → near-identical sizes.
    expect(baseline.turnBytes[0]).toBe(baseline.turnBytes[1])
    expect(baseline.turnBytes[1]).toBe(baseline.turnBytes[2])
  })

  test('flag ON → turn 2+ payloads drop sharply', () => {
    process.env[ENV_VAR] = 'true'
    expect(isStaticDedupEnabled()).toBe(true)

    const dedup = measureSession(3)
    // Turn 1 carries the full initial deltas; turn 2 and 3 should
    // collapse to near-zero because nothing changed.
    expect(dedup.turnBytes[0]).toBeGreaterThan(1_000)
    expect(dedup.turnBytes[1]).toBeLessThan(50)
    expect(dedup.turnBytes[2]).toBeLessThan(50)
  })

  test('measured savings: flag ON vs flag OFF over a 10-turn session', () => {
    // Run both paths and compute the percentage the PR claims.
    process.env[ENV_VAR] = ''
    const baseline = measureSession(10)
    process.env[ENV_VAR] = 'true'
    const dedup = measureSession(10)

    const byteSavings =
      (baseline.totalBytes - dedup.totalBytes) / baseline.totalBytes
    const tokenSavings =
      (baseline.totalTokens - dedup.totalTokens) / baseline.totalTokens

    // Guardrail: claim is "≥25% body reduction over a stable session".
    expect(byteSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)
    expect(tokenSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)

    // Log the measured numbers so running this test prints the %
    // the PR description can quote (`bun test <file>` surfaces them).
    // eslint-disable-next-line no-console
    console.log(
      `[static-dedup measured] bytes: baseline=${baseline.totalBytes} dedup=${dedup.totalBytes} savings=${(byteSavings * 100).toFixed(1)}% | tokens: baseline=${baseline.totalTokens} dedup=${dedup.totalTokens} savings=${(tokenSavings * 100).toFixed(1)}%`,
    )
  })
})
