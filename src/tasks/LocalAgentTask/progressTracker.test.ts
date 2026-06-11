import { describe, expect, test } from 'bun:test'

import type { Message } from '../../types/message.js'
import {
  createProgressTracker,
  getProgressUpdate,
  getTokenCountFromTracker,
  updateProgressFromMessage,
} from './LocalAgentTask.js'

// Pin issue #475 — agent-team teammate pill in TeammateSpinnerLine reads
// `teammate.progress?.tokenCount` and `teammate.progress?.toolUseCount`. Those
// are populated by `getProgressUpdate(tracker)` in inProcessRunner.ts. Before
// the fix the runner re-created the tracker on every prompt iteration, so
// across multi-prompt teammate conversations the pill kept resetting to the
// current prompt's per-call counts (often 0 between turns). These tests pin
// the cumulative-across-iterations contract the runner now relies on.

function assistantMessage(
  inputTokens: number,
  outputTokens: number,
  options: {
    toolUses?: Array<{ id: string; name: string; input?: Record<string, unknown> }>
    cacheCreation?: number
    cacheRead?: number
  } = {},
): Message {
  const { toolUses = [], cacheCreation, cacheRead } = options
  return {
    type: 'assistant',
    message: {
      content: toolUses.map(({ id, name, input }) => ({
        type: 'tool_use',
        id,
        name,
        input: input ?? {},
      })),
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        ...(cacheCreation !== undefined
          ? { cache_creation_input_tokens: cacheCreation }
          : {}),
        ...(cacheRead !== undefined
          ? { cache_read_input_tokens: cacheRead }
          : {}),
      },
    },
    // Minimal fixture (no uuid/model/full usage) — cast type-side only.
  } as unknown as Message
}

describe('progress tracker (issue #475)', () => {
  test('output tokens accumulate across multiple assistant messages', () => {
    const tracker = createProgressTracker()

    updateProgressFromMessage(tracker, assistantMessage(100, 50))
    updateProgressFromMessage(tracker, assistantMessage(120, 30))
    updateProgressFromMessage(tracker, assistantMessage(140, 20))

    expect(tracker.cumulativeOutputTokens).toBe(100)
    expect(tracker.latestInputTokens).toBe(140)
    expect(getTokenCountFromTracker(tracker)).toBe(240)
  })

  test('cumulative semantic survives a simulated multi-prompt teammate session', () => {
    // Simulates inProcessRunner's loop: two leader prompts to the same
    // teammate, each driving multiple assistant turns. The runner now
    // reuses one tracker across both prompts so `task.progress.tokenCount`
    // reflects the teammate's total spend, not just the latest prompt.
    const tracker = createProgressTracker()

    // First prompt — 3 assistant turns
    updateProgressFromMessage(tracker, assistantMessage(500, 100))
    updateProgressFromMessage(tracker, assistantMessage(800, 200))
    updateProgressFromMessage(tracker, assistantMessage(1200, 150))

    const afterFirstPrompt = getProgressUpdate(tracker)
    expect(afterFirstPrompt.tokenCount).toBeGreaterThan(0)

    // Second prompt — 2 assistant turns; `forkContextMessages` re-sends
    // history so input_tokens is large but already cumulative-per-request.
    updateProgressFromMessage(tracker, assistantMessage(2100, 80))
    updateProgressFromMessage(tracker, assistantMessage(2400, 90))

    const afterSecondPrompt = getProgressUpdate(tracker)

    // tokenCount must monotonically increase across prompts. Before the
    // fix the runner reset the tracker between prompts, so this value
    // could drop or zero out between turns.
    expect(afterSecondPrompt.tokenCount).toBeGreaterThan(
      afterFirstPrompt.tokenCount,
    )
    // Cumulative outputs across both prompts: 100 + 200 + 150 + 80 + 90.
    expect(tracker.cumulativeOutputTokens).toBe(620)
    expect(tracker.latestInputTokens).toBe(2400)
    expect(afterSecondPrompt.tokenCount).toBe(3020)
  })

  test('fresh tracker per prompt would drop prior outputs (regression repro)', () => {
    // This pins the failure mode #475 was reporting: the leader's pill
    // showed per-prompt counters instead of running totals. The runner
    // used to behave like this — resetting the tracker between prompts
    // erased all prior output tokens and tool-use counts.
    const promptOne = createProgressTracker()
    updateProgressFromMessage(
      promptOne,
      assistantMessage(500, 100, {
        toolUses: [{ id: 'a', name: 'Read', input: {} }],
      }),
    )
    updateProgressFromMessage(
      promptOne,
      assistantMessage(800, 200, {
        toolUses: [{ id: 'b', name: 'Grep', input: {} }],
      }),
    )

    const promptTwo = createProgressTracker()
    updateProgressFromMessage(promptTwo, assistantMessage(2100, 80))

    // Output tokens from prompt one (300) are gone in the reset world.
    expect(promptTwo.cumulativeOutputTokens).toBe(80)
    // Tool uses from prompt one (2) are gone too — leader's "0 tool uses"
    // display is the visible symptom of this.
    expect(promptTwo.toolUseCount).toBe(0)
    expect(promptOne.toolUseCount).toBe(2)
  })

  test('tool use count accumulates across assistant messages', () => {
    const tracker = createProgressTracker()

    updateProgressFromMessage(
      tracker,
      assistantMessage(100, 10, {
        toolUses: [
          { id: 'tu-1', name: 'Read', input: { file_path: '/a' } },
          { id: 'tu-2', name: 'Grep', input: { pattern: 'foo' } },
        ],
      }),
    )
    updateProgressFromMessage(
      tracker,
      assistantMessage(120, 10, {
        toolUses: [{ id: 'tu-3', name: 'Bash', input: { command: 'ls' } }],
      }),
    )

    expect(tracker.toolUseCount).toBe(3)
    const progress = getProgressUpdate(tracker)
    expect(progress.toolUseCount).toBe(3)
  })

  test('cache_creation and cache_read input tokens are added to latestInputTokens', () => {
    const tracker = createProgressTracker()

    updateProgressFromMessage(
      tracker,
      assistantMessage(1000, 50, { cacheCreation: 200, cacheRead: 800 }),
    )

    expect(tracker.latestInputTokens).toBe(2000)
    expect(getTokenCountFromTracker(tracker)).toBe(2050)
  })

  test('recentActivities are capped while toolUseCount still accumulates', () => {
    const tracker = createProgressTracker()

    for (let i = 0; i < 10; i++) {
      updateProgressFromMessage(
        tracker,
        assistantMessage(100, 5, {
          toolUses: [{ id: `tu-${i}`, name: 'Read', input: { file_path: `/${i}` } }],
        }),
      )
    }

    expect(tracker.toolUseCount).toBe(10)
    // MAX_RECENT_ACTIVITIES is 5; the array should stay bounded so the UI
    // preview doesn't bloat over a long teammate session.
    expect(tracker.recentActivities.length).toBeLessThanOrEqual(5)
  })
})
