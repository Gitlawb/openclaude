import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Source-scan regression (same approach as REPL.queryLifecycle.test.ts) for the
// turn-boundary clearing of the streaming-text refs. The streaming optimization
// keeps the full accumulated text in streamingTextRef and the last published
// preview in lastFlushedStreamingVisibleRef. If a reset / next-turn path nulls
// one but not the other, cancelling a later turn before any new delta arrives
// could re-append the previous answer's text (Esc reads streamingTextRef) or
// fail to re-publish (lastFlushedStreamingVisibleRef stays non-null). A unit
// test of the extracted helper cannot catch that wiring regression, so assert
// the clears directly against the component source.
const source = readFileSync(join(import.meta.dirname, 'REPL.tsx'), 'utf8')

describe('REPL streaming-text clear wiring', () => {
  test('every streamingTextRef clear also clears the preview ref and publishes null', () => {
    // The full reset that each turn-boundary path must perform, in order.
    const fullClear =
      /streamingTextRef\.current = null;\s*lastFlushedStreamingVisibleRef\.current = null;\s*setStreamingText\(null\);/g
    const fullClears = source.match(fullClear) ?? []

    // Both the cancel/reset path and the next-turn start must perform it.
    expect(fullClears.length).toBeGreaterThanOrEqual(2)

    // No partial clear may exist: every streamingTextRef null-assignment must be
    // part of the full trio above (so a stale ref can never survive a turn).
    const bareTextClears = (
      source.match(/streamingTextRef\.current = null/g) ?? []
    ).length
    expect(bareTextClears).toBe(fullClears.length)
  })
})
