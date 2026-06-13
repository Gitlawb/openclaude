import { describe, expect, test } from 'bun:test'

import {
  decideStreamingTextUpdate,
  visibleStreamingPreview,
} from './streamingTextPublish.js'

const append = (delta: string) => (current: string | null) =>
  (current ?? '') + delta

// Drive a sequence of deltas through the decision the way REPL's onStreamingText
// does: keep `ref` (full accumulated text) and `lastVisible` (last published
// preview), recording each publish. Mirrors the component's side effects.
function runDeltas(
  deltas: Array<(current: string | null) => string | null>,
  showPreview: boolean,
) {
  let ref: string | null = null
  let lastVisible: string | null = null
  const published: Array<string | null> = []
  for (const apply of deltas) {
    const d = decideStreamingTextUpdate(ref, apply, showPreview, lastVisible)
    ref = d.nextText
    if (d.publish) {
      lastVisible = d.nextVisible
      published.push(d.nextText)
    }
  }
  return { ref, published }
}

describe('visibleStreamingPreview', () => {
  test('hides the in-progress trailing line (only newline-terminated text shows)', () => {
    expect(visibleStreamingPreview(null)).toBeNull()
    expect(visibleStreamingPreview('partial line')).toBeNull()
    expect(visibleStreamingPreview('line1\npart')).toBe('line1\n')
    expect(visibleStreamingPreview('a\nb\nc\n')).toBe('a\nb\nc\n')
  })
})

describe('decideStreamingTextUpdate', () => {
  test('preview disabled: deltas still accumulate in the ref but never publish', () => {
    const { ref, published } = runDeltas(
      [append('Hello '), append('world'), append('!\n')],
      /* showPreview */ false,
    )
    // Full text is preserved for the Esc handler...
    expect(ref).toBe('Hello world!\n')
    // ...but nothing was ever published (no renders while the preview is hidden).
    expect(published).toEqual([])
  })

  test('preview enabled: only newline-completing deltas publish', () => {
    const { ref, published } = runDeltas(
      [
        append('Hel'), // no newline -> no publish
        append('lo'), // no newline -> no publish
        append(' world\n'), // newline -> publish
        append('next part'), // no newline -> no publish
        append(' done\n'), // newline -> publish
      ],
      /* showPreview */ true,
    )
    expect(ref).toBe('Hello world\nnext part done\n')
    // Two publishes, each the full accumulated text at the newline boundary.
    expect(published).toEqual(['Hello world\n', 'Hello world\nnext part done\n'])
  })

  test('the ref holds the full accumulated text the Esc handler would restore', () => {
    // Reduced-motion users (preview off) press Esc mid-stream: the recovered
    // text is the ref, which must equal everything streamed so far.
    const { ref } = runDeltas(
      [append('partial answer with no trailing newline yet')],
      /* showPreview */ false,
    )
    expect(ref).toBe('partial answer with no trailing newline yet')
  })

  test('a clear (updater -> null) publishes to drop the visible preview', () => {
    let lastVisible: string | null = 'line1\n'
    const clear = decideStreamingTextUpdate(
      'line1\nin progress',
      () => null,
      /* showPreview */ true,
      lastVisible,
    )
    expect(clear.nextText).toBeNull()
    expect(clear.publish).toBe(true)
    expect(clear.nextVisible).toBeNull()
  })

  test('preview enabled but visible unchanged does not publish (idempotent ref write)', () => {
    const d = decideStreamingTextUpdate(
      'done\n',
      append('more'),
      /* showPreview */ true,
      'done\n',
    )
    expect(d.nextText).toBe('done\nmore')
    expect(d.publish).toBe(false) // visible preview still "done\n"
  })
})
