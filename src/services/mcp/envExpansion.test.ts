import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { expandEnvVarsInString } from './envExpansion.js'

describe('expandEnvVarsInString', () => {
  const saved: Record<string, string | undefined> = {}
  const keys = ['ENVEXP_SET', 'ENVEXP_UNSET']

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k]
    process.env.ENVEXP_SET = 'real'
    delete process.env.ENVEXP_UNSET
  })
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  test('preserves a default value that itself contains ":-"', () => {
    // JS String.split(sep, 2) would discard everything after the second ":-".
    // bash `${VAR:-a:-b}` yields "a:-b"; the expansion must match.
    expect(
      expandEnvVarsInString('${ENVEXP_UNSET:-a:-b}').expanded,
    ).toBe('a:-b')
  })

  test('expands a set variable and reports no missing vars', () => {
    const r = expandEnvVarsInString('${ENVEXP_SET:-fallback}')
    expect(r.expanded).toBe('real')
    expect(r.missingVars).toEqual([])
  })

  test('uses the default when the variable is unset', () => {
    expect(expandEnvVarsInString('${ENVEXP_UNSET:-fallback}').expanded).toBe(
      'fallback',
    )
  })

  test('supports an empty default', () => {
    expect(expandEnvVarsInString('${ENVEXP_UNSET:-}').expanded).toBe('')
  })

  test('reports a missing variable with no default', () => {
    const r = expandEnvVarsInString('${ENVEXP_UNSET}')
    expect(r.expanded).toBe('${ENVEXP_UNSET}')
    expect(r.missingVars).toEqual(['ENVEXP_UNSET'])
  })
})
