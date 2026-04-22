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
import { describe, expect, test } from 'bun:test'
import { estimateWithBounds } from '../services/tokenEstimation.js'
import { getClaudeMdDelta } from './claudeMdDelta.js'
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
    const content = repeat(TYPICAL_CLAUDE_MD_SIZE)
    const messages: AttachmentMessage[] = []

    // Turn 1 — initial emission
    const d1 = getClaudeMdDelta(content, messages)
    expect(d1).not.toBeNull()
    expect(d1!.isInitial).toBe(true)
    expect(d1!.addedContent.length).toBe(TYPICAL_CLAUDE_MD_SIZE)
    messages.push(
      claudeMdDeltaMsg(d1!.addedContent, d1!.contentHash, d1!.isInitial),
    )

    // Turn 2 & 3 — content unchanged
    expect(getClaudeMdDelta(content, messages)).toBeNull()
    expect(getClaudeMdDelta(content, messages)).toBeNull()

    // Byte + token accounting for turn 2 specifically. Tokens are the
    // unit the Fase 2 plan targets (-30 to -40% body JSON); bytes are
    // what Copilot bills. Both must move.
    const baselineTurn2 = serialize([baselineClaudeMd(content)])
    const dedupTurn2 = serialize([]) // null → no attachment emitted
    const byteSavings = (baselineTurn2 - dedupTurn2) / baselineTurn2
    expect(byteSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)

    const baselineTokens = estimateTokens([baselineClaudeMd(content)])
    const dedupTokens = estimateTokens([])
    const tokenSavings = (baselineTokens - dedupTokens) / baselineTokens
    expect(tokenSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)
  })

  test('gitStatus: turn 2+ emits zero bytes (snapshot is immutable)', () => {
    const status = repeat(TYPICAL_GIT_STATUS_SIZE)
    const messages: AttachmentMessage[] = []

    const d1 = getGitStatusDelta(status, messages)
    expect(d1).not.toBeNull()
    expect(d1!.content).toBe(status)
    messages.push(gitStatusDeltaMsg(d1!.content))

    // By design: subsequent turns never re-emit (snapshot is immutable)
    expect(getGitStatusDelta(status, messages)).toBeNull()
    expect(getGitStatusDelta(status, messages)).toBeNull()

    const baselineTurn2 = serialize([baselineGitStatus(status)])
    const dedupTurn2 = serialize([])
    const savings = (baselineTurn2 - dedupTurn2) / baselineTurn2
    expect(savings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)
  })

  test('nested memory: turn 2+ emits zero bytes when files unchanged', () => {
    const files: MemoryFileInput[] = Array.from(
      { length: TYPICAL_MEMORY_FILE_COUNT },
      (_, i) => ({
        path: `/pkg-${i}/CLAUDE.md`,
        content: repeat(TYPICAL_MEMORY_FILE_SIZE),
      }),
    )
    const messages: AttachmentMessage[] = []

    const d1 = getMemoryDelta(files, messages)
    expect(d1).not.toBeNull()
    expect(d1!.isInitial).toBe(true)
    expect(d1!.addedNames.length).toBe(TYPICAL_MEMORY_FILE_COUNT)
    messages.push(
      memoryDeltaMsg(
        d1!.addedNames,
        d1!.addedContent,
        d1!.addedHashes,
        d1!.removedNames,
        d1!.isInitial,
      ),
    )

    expect(getMemoryDelta(files, messages)).toBeNull()
    expect(getMemoryDelta(files, messages)).toBeNull()

    const baselineTurn2 = serialize(baselineMemoryAttachments(files))
    const dedupTurn2 = serialize([])
    const savings = (baselineTurn2 - dedupTurn2) / baselineTurn2
    expect(savings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)
  })

  test('todo reminder: turn 2+ emits zero bytes when list unchanged', () => {
    const todos: TodoSnapshotItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `task-${i}`,
      status: 'pending',
      text: `Task number ${i} with enough context to be realistic`,
    }))
    const messages: AttachmentMessage[] = []

    const d1 = getTodoReminderDelta(todos, messages)
    expect(d1).not.toBeNull()
    expect(d1!.isInitial).toBe(true)
    expect(d1!.added.length).toBe(10)
    messages.push(todoReminderDeltaMsg(d1!.snapshot))

    expect(getTodoReminderDelta(todos, messages)).toBeNull()
    expect(getTodoReminderDelta(todos, messages)).toBeNull()

    const baselineTurn2 = serialize([baselineTodoReminder(todos)])
    const dedupTurn2 = serialize([])
    const savings = (baselineTurn2 - dedupTurn2) / baselineTurn2
    expect(savings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)
  })
})

describe('static-dedup integration: combined 3-turn session', () => {
  test('total payload across turns 2-3 is ≥25% smaller than baseline', () => {
    const claudeMd = repeat(TYPICAL_CLAUDE_MD_SIZE)
    const gitStatus = repeat(TYPICAL_GIT_STATUS_SIZE)
    const memFiles: MemoryFileInput[] = Array.from(
      { length: TYPICAL_MEMORY_FILE_COUNT },
      (_, i) => ({
        path: `/pkg-${i}/CLAUDE.md`,
        content: repeat(TYPICAL_MEMORY_FILE_SIZE),
      }),
    )
    const todos: TodoSnapshotItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `task-${i}`,
      status: 'pending',
      text: `Task ${i}`,
    }))

    // --- Baseline (always-emit) accounting for turns 2 and 3 ---
    const baselinePerTurn = serialize([
      baselineClaudeMd(claudeMd),
      baselineGitStatus(gitStatus),
      ...baselineMemoryAttachments(memFiles),
      baselineTodoReminder(todos),
    ])
    const baselineTurns23 = baselinePerTurn * 2

    // --- Dedup path: simulate turn 1 emission, then measure turns 2+3 ---
    const messages: AttachmentMessage[] = []

    // Turn 1 — initial emissions
    const cmd1 = getClaudeMdDelta(claudeMd, messages)
    messages.push(
      claudeMdDeltaMsg(cmd1!.addedContent, cmd1!.contentHash, cmd1!.isInitial),
    )
    const gs1 = getGitStatusDelta(gitStatus, messages)
    messages.push(gitStatusDeltaMsg(gs1!.content))
    const mem1 = getMemoryDelta(memFiles, messages)
    messages.push(
      memoryDeltaMsg(
        mem1!.addedNames,
        mem1!.addedContent,
        mem1!.addedHashes,
        mem1!.removedNames,
        mem1!.isInitial,
      ),
    )
    const td1 = getTodoReminderDelta(todos, messages)
    messages.push(todoReminderDeltaMsg(td1!.snapshot))

    // Turn 2 — measure what gets added (should be ~nothing)
    const turn2Additions: Record<string, unknown>[] = []
    const cmd2 = getClaudeMdDelta(claudeMd, messages)
    if (cmd2) turn2Additions.push({ type: 'claude_md_delta', ...cmd2 })
    const gs2 = getGitStatusDelta(gitStatus, messages)
    if (gs2) turn2Additions.push({ type: 'git_status_delta', ...gs2 })
    const mem2 = getMemoryDelta(memFiles, messages)
    if (mem2) turn2Additions.push({ type: 'memory_delta', ...mem2 })
    const td2 = getTodoReminderDelta(todos, messages)
    if (td2) turn2Additions.push({ type: 'todo_reminder_delta', ...td2 })

    // Turn 3 — measure what gets added
    const turn3Additions: Record<string, unknown>[] = []
    const cmd3 = getClaudeMdDelta(claudeMd, messages)
    if (cmd3) turn3Additions.push({ type: 'claude_md_delta', ...cmd3 })
    const gs3 = getGitStatusDelta(gitStatus, messages)
    if (gs3) turn3Additions.push({ type: 'git_status_delta', ...gs3 })
    const mem3 = getMemoryDelta(memFiles, messages)
    if (mem3) turn3Additions.push({ type: 'memory_delta', ...mem3 })
    const td3 = getTodoReminderDelta(todos, messages)
    if (td3) turn3Additions.push({ type: 'todo_reminder_delta', ...td3 })

    const dedupTurns23 = serialize(turn2Additions) + serialize(turn3Additions)
    const byteSavings = (baselineTurns23 - dedupTurns23) / baselineTurns23
    expect(byteSavings).toBeGreaterThanOrEqual(MIN_SAVINGS_RATIO)

    // Token-level savings — matches the unit the Fase 2 plan targets.
    // estimateWithBounds uses the project's `json` compression ratio
    // (~2 chars/token), so the number reflects what a tokenizer would
    // produce on the wire, not a hardcoded char-per-token guess.
    const baselineTokens =
      estimateTokens([
        baselineClaudeMd(claudeMd),
        baselineGitStatus(gitStatus),
        ...baselineMemoryAttachments(memFiles),
        baselineTodoReminder(todos),
      ]) * 2
    const dedupTokens =
      estimateTokens(turn2Additions) + estimateTokens(turn3Additions)
    const tokenSavings = (baselineTokens - dedupTokens) / baselineTokens
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
    const original = repeat(TYPICAL_CLAUDE_MD_SIZE)
    const changed = original + 'NEW_SECTION'
    const messages: AttachmentMessage[] = []

    const d1 = getClaudeMdDelta(original, messages)
    messages.push(
      claudeMdDeltaMsg(d1!.addedContent, d1!.contentHash, d1!.isInitial),
    )
    // Real drift: must re-emit
    const d2 = getClaudeMdDelta(changed, messages)
    expect(d2).not.toBeNull()
    expect(d2!.addedContent).toBe(changed)
    expect(d2!.isInitial).toBe(false)
  })
})
