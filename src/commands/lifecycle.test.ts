import { describe, test, expect } from 'bun:test'
import lifecycle from './lifecycle.js'

describe('lifecycle command', () => {
  test('has correct name', () => {
    expect(lifecycle.name).toBe('lifecycle')
  })

  test('has correct type', () => {
    expect(lifecycle.type).toBe('prompt')
  })

  test('has a description', () => {
    expect(lifecycle.description).toBeTruthy()
    expect(typeof lifecycle.description).toBe('string')
  })

  test('has source set to builtin', () => {
    expect(lifecycle.source).toBe('builtin')
  })
})
