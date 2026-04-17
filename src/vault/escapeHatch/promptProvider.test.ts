import { describe, test, expect } from 'bun:test'
import {
  createStubProvider,
  createForbiddenProvider,
} from './promptProvider.js'

describe('createStubProvider', () => {
  test('returns answers in order', async () => {
    const p = createStubProvider(['yes', 'no', 'maybe'])
    expect(await p.prompt('q1')).toBe('yes')
    expect(await p.prompt('q2')).toBe('no')
    expect(await p.prompt('q3')).toBe('maybe')
  })

  test('returns null after answers exhausted', async () => {
    const p = createStubProvider(['only-one'])
    expect(await p.prompt('q1')).toBe('only-one')
    expect(await p.prompt('q2')).toBeNull()
    expect(await p.prompt('q3')).toBeNull()
  })

  test('passes through a literal null in the answers array', async () => {
    const p = createStubProvider(['first', null, 'third'])
    expect(await p.prompt('q1')).toBe('first')
    expect(await p.prompt('q2')).toBeNull()
    expect(await p.prompt('q3')).toBe('third')
  })

  test('empty answers array always returns null', async () => {
    const p = createStubProvider([])
    expect(await p.prompt('q1')).toBeNull()
  })
})

describe('createForbiddenProvider', () => {
  test('throws if invoked', async () => {
    const p = createForbiddenProvider()
    await expect(p.prompt('q')).rejects.toThrow(/should not have been/)
  })
})
