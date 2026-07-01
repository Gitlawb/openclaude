import { describe, expect, test } from 'bun:test'
import { isCodexAlias, shouldUseCodexTransport } from './providerConfig.js'

// Regression: CODEX_ALIAS_MODELS is a plain object literal, and the alias
// lookups keyed it with a config/CLI-controlled model string. Names inherited
// from Object.prototype resolved through the prototype chain, so `key in map`
// and `map[key]` reported a match for strings that are NOT Codex aliases. That
// made `isCodexAlias('constructor')` return true and, with no explicit base
// URL, `shouldUseCodexTransport` misroute the request through the Codex
// transport. The lookups must only see own enumerable aliases.
//
// The lookups lower-case the model string first, so the reachable inherited
// keys are the ones that are already all-lowercase: `constructor` and
// `__proto__`. (`toString`/`valueOf`/etc. lower-case to non-keys and never
// matched, so they are not the regression surface.)
describe('providerConfig — Codex alias lookup is prototype-safe', () => {
  const protoNames = ['constructor', '__proto__']

  for (const name of protoNames) {
    test(`isCodexAlias('${name}') is false (inherited, not a real alias)`, () => {
      expect(isCodexAlias(name)).toBe(false)
    })

    test(`shouldUseCodexTransport('${name}', undefined) does not misroute`, () => {
      expect(shouldUseCodexTransport(name, undefined)).toBe(false)
    })
  }

  // Controls: real aliases still resolve.
  test('genuine aliases are still recognized', () => {
    expect(isCodexAlias('codexplan')).toBe(true)
    expect(isCodexAlias('gpt-5.5')).toBe(true)
    expect(shouldUseCodexTransport('codexplan', undefined)).toBe(true)
  })

  // Non-aliases (real model ids that aren't Codex) stay false.
  test('non-Codex model ids are not treated as aliases', () => {
    expect(isCodexAlias('claude-opus-4-8')).toBe(false)
    expect(shouldUseCodexTransport('claude-opus-4-8', undefined)).toBe(false)
  })
})
