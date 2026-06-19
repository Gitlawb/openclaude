import { describe, expect, test } from 'bun:test'
import { parseUserSpecifiedModel } from './model.js'

// Regression: the `best` alias dropped the `[1m]` (1M-context) tag while the
// other aliases (opus/sonnet/haiku) preserved it. `best` resolves to the same
// model as `opus`, so `best[1m]` should behave exactly like `opus[1m]` and keep
// the 1M tag. Assertions are relational so they don't pin a specific model id.
describe('parseUserSpecifiedModel — best alias 1M tag', () => {
  test('best[1m] preserves the [1m] tag, matching the opus alias', () => {
    const best = parseUserSpecifiedModel('best')
    const best1m = parseUserSpecifiedModel('best[1m]')

    expect(best1m).toBe(`${best}[1m]`)
    expect(best1m.endsWith('[1m]')).toBe(true)
  })

  test('best and best[1m] track the opus alias exactly', () => {
    expect(parseUserSpecifiedModel('best')).toBe(parseUserSpecifiedModel('opus'))
    expect(parseUserSpecifiedModel('best[1m]')).toBe(
      parseUserSpecifiedModel('opus[1m]'),
    )
  })

  test('the tag is case-insensitive and not duplicated', () => {
    const best1m = parseUserSpecifiedModel('best[1m]')
    expect(parseUserSpecifiedModel('BEST[1M]')).toBe(best1m)
    // exactly one trailing [1m], no doubling
    expect(best1m.match(/\[1m]/gi)?.length).toBe(1)
  })
})
