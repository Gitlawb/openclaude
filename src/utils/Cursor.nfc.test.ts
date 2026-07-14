import { describe, expect, test } from 'bun:test'
import { Cursor } from './Cursor.js'

describe('Cursor.insert NFC boundary offset', () => {
  test('places the cursor correctly when the insert composes with the prefix', () => {
    // Cursor sits between "e" and "X". Inserting a combining acute accent
    // composes with the "e" into a single "é", so the normalized text is "éX"
    // (length 2) and the cursor belongs at offset 1 (before "X"). The old code
    // measured the insert in isolation and landed at offset 2 (after "X").
    const c = Cursor.fromText('eX', 80, 1)
    expect(c.text).toBe('eX')

    const after = c.insert('́')
    expect(after.text).toBe('éX')
    expect(after.offset).toBe(1)
  })

  test('non-composing inserts still advance by the inserted length', () => {
    const c = Cursor.fromText('abcX', 80, 3) // between "abc" and "X"
    const after = c.insert('de')
    expect(after.text).toBe('abcdeX')
    expect(after.offset).toBe(5)
  })

  test('astral-plane insert advances by its UTF-16 unit count', () => {
    const c = Cursor.fromText('X', 80, 0)
    const after = c.insert('😀') // 2 UTF-16 code units
    expect(after.text).toBe('😀X')
    expect(after.offset).toBe(2)
  })
})
