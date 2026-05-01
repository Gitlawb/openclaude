import { describe, expect, test } from 'bun:test'
import { parseArgs } from './repomap.js'

describe('/repomap argument parsing', () => {
  test('defaults to 1024 tokens with no flags', () => {
    const result = parseArgs('')
    expect(result.tokens).toBe(2048)
    expect(result.focus).toEqual([])
    expect(result.invalidate).toBe(false)
    expect(result.stats).toBe(false)
  })

  test('parses --tokens flag', () => {
    const result = parseArgs('--tokens 4096')
    expect(result.tokens).toBe(4096)
  })

  test('rejects --tokens below 256', () => {
    const result = parseArgs('--tokens 100')
    expect(result.tokens).toBe(2048) // falls back to default
  })

  test('rejects --tokens above 16384', () => {
    const result = parseArgs('--tokens 20000')
    expect(result.tokens).toBe(2048) // falls back to default
  })

  test('parses --focus flag', () => {
    const result = parseArgs('--focus src/tools/')
    expect(result.focus).toEqual(['src/tools/'])
  })

  test('parses multiple --focus flags', () => {
    const result = parseArgs('--focus src/tools/ --focus src/context.ts')
    expect(result.focus).toEqual(['src/tools/', 'src/context.ts'])
  })

  test('parses --invalidate flag', () => {
    const result = parseArgs('--invalidate')
    expect(result.invalidate).toBe(true)
    expect(result.stats).toBe(false)
  })

  test('parses --stats flag', () => {
    const result = parseArgs('--stats')
    expect(result.stats).toBe(true)
    expect(result.invalidate).toBe(false)
  })

  test('parses combined flags', () => {
    const result = parseArgs('--tokens 2048 --focus src/tools/ --invalidate')
    expect(result.tokens).toBe(2048)
    expect(result.focus).toEqual(['src/tools/'])
    expect(result.invalidate).toBe(true)
  })
})
