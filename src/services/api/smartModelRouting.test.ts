import { describe, expect, test } from 'bun:test'

import {
  routeModel,
  type SmartRoutingConfig,
} from './smartModelRouting.ts'

const ENABLED: SmartRoutingConfig = {
  enabled: true,
  simpleModel: 'claude-haiku-4-5',
  strongModel: 'claude-opus-4-7',
}

describe('routeModel — disabled / misconfigured', () => {
  test('disabled config routes to strong', () => {
    const decision = routeModel(
      { userText: 'hi' },
      { ...ENABLED, enabled: false },
    )
    expect(decision.model).toBe('claude-opus-4-7')
    expect(decision.complexity).toBe('strong')
    expect(decision.reason).toContain('disabled')
  })

  test('missing simpleModel falls back to strong', () => {
    const decision = routeModel(
      { userText: 'hi' },
      { ...ENABLED, simpleModel: '' },
    )
    expect(decision.model).toBe('claude-opus-4-7')
    expect(decision.complexity).toBe('strong')
  })

  test('simpleModel === strongModel routes to strong (no-op)', () => {
    const decision = routeModel(
      { userText: 'hi' },
      { ...ENABLED, simpleModel: 'claude-opus-4-7' },
    )
    expect(decision.model).toBe('claude-opus-4-7')
    expect(decision.complexity).toBe('strong')
  })
})

describe('routeModel — simple path', () => {
  test('short greeting routes to simple', () => {
    const decision = routeModel({ userText: 'thanks!', turnNumber: 5 }, ENABLED)
    expect(decision.model).toBe('claude-haiku-4-5')
    expect(decision.complexity).toBe('simple')
  })

  test('empty input routes to simple', () => {
    const decision = routeModel({ userText: '   ' }, ENABLED)
    expect(decision.model).toBe('claude-haiku-4-5')
    expect(decision.complexity).toBe('simple')
  })

  test('mid-length chatter routes to simple', () => {
    const decision = routeModel(
      { userText: 'yep looks good, go ahead', turnNumber: 10 },
      ENABLED,
    )
    expect(decision.complexity).toBe('simple')
  })
})

describe('routeModel — strong path', () => {
  test('first turn always routes to strong, even when short', () => {
    const decision = routeModel(
      { userText: 'fix the bug', turnNumber: 1 },
      ENABLED,
    )
    expect(decision.model).toBe('claude-opus-4-7')
    expect(decision.complexity).toBe('strong')
    expect(decision.reason).toContain('first turn')
  })

  test('code fence routes to strong', () => {
    const decision = routeModel(
      {
        userText: 'change this:\n```\nfoo()\n```',
        turnNumber: 5,
      },
      ENABLED,
    )
    expect(decision.complexity).toBe('strong')
    expect(decision.reason).toContain('code')
  })

  test('inline code span routes to strong', () => {
    const decision = routeModel(
      { userText: 'rename `foo` to `bar`', turnNumber: 5 },
      ENABLED,
    )
    expect(decision.complexity).toBe('strong')
  })

  test('reasoning keyword "plan" routes to strong even when short', () => {
    const decision = routeModel(
      { userText: 'plan the refactor', turnNumber: 5 },
      ENABLED,
    )
    expect(decision.complexity).toBe('strong')
    expect(decision.reason).toContain('keyword')
  })

  test('reasoning keyword "debug" routes to strong', () => {
    const decision = routeModel(
      { userText: 'debug the test', turnNumber: 5 },
      ENABLED,
    )
    expect(decision.complexity).toBe('strong')
  })

  test('"root cause" multi-word keyword routes to strong', () => {
    const decision = routeModel(
      { userText: 'find the root cause', turnNumber: 5 },
      ENABLED,
    )
    expect(decision.complexity).toBe('strong')
  })

  test('multi-paragraph input routes to strong', () => {
    const decision = routeModel(
      {
        userText: 'first thought.\n\nsecond thought.',
        turnNumber: 5,
      },
      ENABLED,
    )
    expect(decision.complexity).toBe('strong')
    expect(decision.reason).toContain('multi-paragraph')
  })

  test('over-long input routes to strong', () => {
    const long = 'ok '.repeat(100) // ~300 chars, 100 words
    const decision = routeModel(
      { userText: long, turnNumber: 5 },
      ENABLED,
    )
    expect(decision.complexity).toBe('strong')
  })

  test('exactly at the boundary stays simple', () => {
    const text = 'a'.repeat(160)
    const decision = routeModel(
      { userText: text, turnNumber: 5 },
      { ...ENABLED, simpleMaxChars: 160, simpleMaxWords: 28 },
    )
    expect(decision.complexity).toBe('simple')
  })

  test('one char over the boundary routes to strong', () => {
    const text = 'a'.repeat(161)
    const decision = routeModel(
      { userText: text, turnNumber: 5 },
      { ...ENABLED, simpleMaxChars: 160, simpleMaxWords: 28 },
    )
    expect(decision.complexity).toBe('strong')
    expect(decision.reason).toContain('160 chars')
  })
})

describe('routeModel — config overrides', () => {
  test('custom simpleMaxChars is honored', () => {
    const decision = routeModel(
      { userText: 'abcdefghijklmnop', turnNumber: 5 },
      { ...ENABLED, simpleMaxChars: 10 },
    )
    expect(decision.complexity).toBe('strong')
    expect(decision.reason).toContain('10 chars')
  })

  test('custom simpleMaxWords is honored', () => {
    const decision = routeModel(
      { userText: 'one two three four five', turnNumber: 5 },
      { ...ENABLED, simpleMaxWords: 3 },
    )
    expect(decision.complexity).toBe('strong')
    expect(decision.reason).toContain('3 words')
  })
})

describe('routeModel — reason strings', () => {
  test('simple decisions include char + word counts', () => {
    const decision = routeModel(
      { userText: 'sounds good', turnNumber: 5 },
      ENABLED,
    )
    expect(decision.reason).toMatch(/\d+ chars, \d+ words/)
  })
})
