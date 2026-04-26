import { describe, expect, test } from 'bun:test'

import {
  createThinkTagFilter,
  stripThinkTags,
} from './thinkTagSanitizer.ts'

describe('stripThinkTags — whole-text cleanup', () => {
  test('strips closed think pair', () => {
    expect(stripThinkTags('<think>reasoning</think>Hello')).toBe('Hello')
  })

  test('strips closed thinking pair', () => {
    expect(stripThinkTags('<thinking>x</thinking>Out')).toBe('Out')
  })

  test('strips closed reasoning pair', () => {
    expect(stripThinkTags('<reasoning>x</reasoning>Out')).toBe('Out')
  })

  test('strips REASONING_SCRATCHPAD pair', () => {
    expect(stripThinkTags('<REASONING_SCRATCHPAD>plan</REASONING_SCRATCHPAD>Answer'))
      .toBe('Answer')
  })

  test('is case-insensitive', () => {
    expect(stripThinkTags('<THINKING>x</THINKING>out')).toBe('out')
    expect(stripThinkTags('<Think>x</Think>out')).toBe('out')
  })

  test('handles attributes on open tag', () => {
    expect(stripThinkTags('<think id="plan-1">reason</think>ok')).toBe('ok')
  })

  test('strips unterminated open tag at block boundary', () => {
    expect(stripThinkTags('<think>reasoning that never closes')).toBe('')
  })

  test('strips unterminated open tag after newline', () => {
    // Block-boundary match consumes the leading newline, same as hermes.
    expect(stripThinkTags('Answer: 42\n<think>second-guess myself'))
      .toBe('Answer: 42')
  })

  test('strips orphan close tag', () => {
    expect(stripThinkTags('trailing </think>done')).toBe('trailing done')
  })

  test('strips multiple blocks', () => {
    expect(stripThinkTags('<think>a</think>B<think>c</think>D')).toBe('BD')
  })

  test('handles reasoning mid-response after content', () => {
    expect(stripThinkTags('Answer: 42\n<think>double-check</think>\nDone'))
      .toBe('Answer: 42\n\nDone')
  })

  test('handles nested-looking tags (lazy match + orphan cleanup)', () => {
    expect(stripThinkTags('<think><think>x</think></think>y')).toBe('y')
  })

  test('preserves legitimate non-think tags', () => {
    expect(stripThinkTags('use <div> and <span>')).toBe('use <div> and <span>')
  })

  test('preserves text without any tags', () => {
    expect(stripThinkTags('Hello, world. I should respond briefly.')).toBe(
      'Hello, world. I should respond briefly.',
    )
  })

  test('handles empty input', () => {
    expect(stripThinkTags('')).toBe('')
  })
})

describe('createThinkTagFilter — streaming state machine', () => {
  test('passes through plain text', () => {
    const f = createThinkTagFilter()
    expect(f.feed('Hello, ')).toBe('Hello, ')
    expect(f.feed('world!')).toBe('world!')
    expect(f.flush()).toBe('')
  })

  test('strips a complete think block in one chunk', () => {
    const f = createThinkTagFilter()
    expect(f.feed('pre<think>reason</think>post')).toBe('prepost')
    expect(f.flush()).toBe('')
  })

  test('handles open tag split across deltas', () => {
    const f = createThinkTagFilter()
    expect(f.feed('before<th')).toBe('before')
    expect(f.feed('ink>reason</think>after')).toBe('after')
    expect(f.flush()).toBe('')
  })

  test('handles close tag split across deltas', () => {
    const f = createThinkTagFilter()
    expect(f.feed('<think>reason</th')).toBe('')
    expect(f.feed('ink>keep')).toBe('keep')
    expect(f.flush()).toBe('')
  })

  test('handles tag split on bare < boundary', () => {
    const f = createThinkTagFilter()
    expect(f.feed('leading <')).toBe('leading ')
    expect(f.feed('think>inner</think>tail')).toBe('tail')
    expect(f.flush()).toBe('')
  })

  test('preserves partial non-tag < at boundary when next char rules it out', () => {
    const f = createThinkTagFilter()
    // "<d" — 'd' cannot start any of our tag names, so emit immediately
    expect(f.feed('pre<d')).toBe('pre<d')
    expect(f.feed('iv>rest')).toBe('iv>rest')
    expect(f.flush()).toBe('')
  })

  test('case-insensitive streaming', () => {
    const f = createThinkTagFilter()
    expect(f.feed('<THINKING>x</THINKING>out')).toBe('out')
    expect(f.flush()).toBe('')
  })

  test('unterminated open tag — flush drops remainder', () => {
    const f = createThinkTagFilter()
    expect(f.feed('<think>reasoning with no close ')).toBe('')
    expect(f.feed('and more reasoning')).toBe('')
    expect(f.flush()).toBe('')
    expect(f.isInsideBlock()).toBe(false)
  })

  test('multiple blocks in single feed', () => {
    const f = createThinkTagFilter()
    expect(f.feed('<think>a</think>B<think>c</think>D')).toBe('BD')
    expect(f.flush()).toBe('')
  })

  test('flush after clean stream emits nothing extra', () => {
    const f = createThinkTagFilter()
    expect(f.feed('complete message')).toBe('complete message')
    expect(f.flush()).toBe('')
  })

  test('flush of bare < at end emits it (not a tag prefix)', () => {
    const f = createThinkTagFilter()
    // bare '<' held back; flush emits it since it has no tag-name chars
    expect(f.feed('x <')).toBe('x ')
    expect(f.flush()).toBe('<')
  })

  test('flush of partial tag-name prefix at end drops it', () => {
    const f = createThinkTagFilter()
    expect(f.feed('x <thi')).toBe('x ')
    expect(f.flush()).toBe('')
  })

  test('handles attributes on streaming open tag', () => {
    const f = createThinkTagFilter()
    expect(f.feed('<think type="plan">reason</think>ok')).toBe('ok')
    expect(f.flush()).toBe('')
  })

  test('mid-delta transition: content, reasoning, content', () => {
    const f = createThinkTagFilter()
    expect(f.feed('Answer: 42\n<think>')).toBe('Answer: 42\n')
    expect(f.feed('double-check')).toBe('')
    expect(f.feed('</think>\nDone')).toBe('\nDone')
    expect(f.flush()).toBe('')
  })

  test('orphan close tag mid-stream is stripped on flush via safety-net behavior', () => {
    // Filter alone treats orphan close as "we're not inside", so it emits as-is.
    // Safety net (stripThinkTags on final text) removes orphans.
    const f = createThinkTagFilter()
    const chunk1 = f.feed('trailing ')
    const chunk2 = f.feed('</think>done')
    const final = chunk1 + chunk2 + f.flush()
    // Orphan close appears in stream output; safety net cleans it
    expect(stripThinkTags(final)).toBe('trailing done')
  })
})
