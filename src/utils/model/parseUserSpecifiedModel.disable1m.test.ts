import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { parseUserSpecifiedModel } from './model.js'

// Regression: when 1M context is disabled (CLAUDE_CODE_DISABLE_1M_CONTEXT, used
// by C4E/HIPAA admins), `has1mContext` returns false. The parser gated the
// stripping of the `[1m]` tag on that flag, so an aliased request like
// `sonnet[1m]` kept the tag attached, never matched the `sonnet` alias, and
// returned the literal, unservable string `sonnet[1m]`. The tag must be stripped
// for matching regardless; only the re-appended suffix depends on 1M being on.
describe('parseUserSpecifiedModel — [1m] tag when 1M context is disabled', () => {
  const original = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT

  beforeEach(() => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
  })
  afterEach(() => {
    if (original === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    } else {
      process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = original
    }
  })

  for (const alias of ['sonnet', 'opus', 'haiku', 'best', 'opusplan']) {
    test(`${alias}[1m] resolves to the base model (no [1m]) when 1M is disabled`, () => {
      const base = parseUserSpecifiedModel(alias)
      const tagged = parseUserSpecifiedModel(`${alias}[1m]`)
      // Base model is returned, with the 1M tag dropped — not a literal alias.
      expect(tagged).toBe(base)
      expect(tagged.endsWith('[1m]')).toBe(false)
      expect(tagged).not.toBe(`${alias}[1m]`)
    })
  }

  test('case-insensitive tag is also resolved (SONNET[1M] → base sonnet)', () => {
    expect(parseUserSpecifiedModel('SONNET[1M]')).toBe(
      parseUserSpecifiedModel('sonnet'),
    )
  })

  test('custom model id drops the [1m] suffix when 1M is disabled', () => {
    expect(parseUserSpecifiedModel('my-custom-deploy[1m]')).toBe(
      'my-custom-deploy',
    )
  })
})

// Guard the opposite direction: with 1M enabled (default), the tag is preserved.
describe('parseUserSpecifiedModel — [1m] tag when 1M context is enabled', () => {
  const original = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT

  beforeEach(() => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  })
  afterEach(() => {
    if (original === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    } else {
      process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = original
    }
  })

  test('sonnet[1m] keeps the tag on the resolved base model', () => {
    const base = parseUserSpecifiedModel('sonnet')
    expect(parseUserSpecifiedModel('sonnet[1m]')).toBe(`${base}[1m]`)
  })

  test('custom model id keeps the [1m] suffix', () => {
    expect(parseUserSpecifiedModel('my-custom-deploy[1m]')).toBe(
      'my-custom-deploy[1m]',
    )
  })
})
