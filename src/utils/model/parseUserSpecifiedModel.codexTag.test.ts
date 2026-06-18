import { describe, expect, test } from 'bun:test'
import { has1mContext } from '../context.js'
import { parseUserSpecifiedModel } from './model.js'

// Regression: the Codex aliases (codexplan/codexspark) dropped the `[1m]`
// (1M-context) tag while every Claude alias (opus/sonnet/haiku/best) preserved
// it. The `[1m]` suffix is an explicit client-side opt-in to the 1M context
// window (see has1mContext), so dropping it silently shrinks a
// `codexplan[1m]`/`codexspark[1m]` session back to the model default. The base
// mapping (no tag) must stay unchanged. Assertions are relational so they don't
// pin a specific gpt model id.
describe('parseUserSpecifiedModel — codex alias 1M tag', () => {
  test('codexplan[1m] keeps the [1m] tag on top of the base mapping', () => {
    const base = parseUserSpecifiedModel('codexplan')
    const tagged = parseUserSpecifiedModel('codexplan[1m]')

    expect(tagged).toBe(`${base}[1m]`)
    expect(has1mContext(tagged)).toBe(true)
  })

  test('codexspark[1m] keeps the [1m] tag on top of the base mapping', () => {
    const base = parseUserSpecifiedModel('codexspark')
    const tagged = parseUserSpecifiedModel('codexspark[1m]')

    expect(tagged).toBe(`${base}[1m]`)
    expect(has1mContext(tagged)).toBe(true)
  })

  test('the bare codex aliases are unchanged and carry no 1M tag', () => {
    expect(parseUserSpecifiedModel('codexplan')).toBe('gpt-5.5')
    expect(parseUserSpecifiedModel('codexspark')).toBe('gpt-5.3-codex-spark')
    expect(has1mContext(parseUserSpecifiedModel('codexplan'))).toBe(false)
    expect(has1mContext(parseUserSpecifiedModel('codexspark'))).toBe(false)
  })

  test('the tag is case-insensitive and not duplicated', () => {
    const tagged = parseUserSpecifiedModel('codexplan[1m]')
    expect(parseUserSpecifiedModel('CODEXPLAN[1M]')).toBe(tagged)
    expect(tagged.match(/\[1m]/gi)?.length).toBe(1)
  })
})
