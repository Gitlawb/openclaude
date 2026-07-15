import { describe, expect, test } from 'bun:test'
import { DEFAULT_REPL_MAX_TURNS, resolveReplMaxTurns } from './replMaxTurns.js'

describe('interactive REPL max-turn cap', () => {
  test('supplies the local interactive default at runtime', () => {
    expect(DEFAULT_REPL_MAX_TURNS).toBe(50)
    expect(resolveReplMaxTurns()).toBe(50)
  })

  test('preserves an explicit interactive cap at runtime', () => {
    expect(resolveReplMaxTurns(7)).toBe(7)
  })
})
