import { describe, expect, test } from 'bun:test'
import {
  corsair,
  ember,
  kage,
  kaio,
  merlin,
  robinhood,
  SPECIES,
  strawhat,
} from './types.js'

describe('species constants', () => {
  // The constants are runtime-constructed via String.fromCharCode (see the
  // canary note in types.ts) and force-cast to their literal types — a single
  // wrong byte would produce a different runtime string that TypeScript
  // cannot catch. Plain literals are safe HERE because test files are never
  // part of the build output the canary check greps.
  test('charCode-encoded constants decode to their declared literals', () => {
    expect(robinhood).toBe('robinhood')
    expect(kaio).toBe('kaio')
    expect(strawhat).toBe('strawhat')
    expect(merlin).toBe('merlin')
    expect(kage).toBe('kage')
    expect(ember).toBe('ember')
    expect(corsair).toBe('corsair')
  })

  test('the pool contains each hero exactly once', () => {
    expect(new Set(SPECIES).size).toBe(SPECIES.length)
    expect(SPECIES.length).toBe(7)
  })
})
