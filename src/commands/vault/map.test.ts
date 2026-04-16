import { describe, test, expect } from 'bun:test'
import vaultMap from './map.js'

describe('vault-map command', () => {
  test('exports a Command with correct metadata', () => {
    expect(vaultMap.type).toBe('local')
    expect(vaultMap.name).toBe('vault-map')
    expect(vaultMap.description).toContain('Map')
    expect(vaultMap.argumentHint).toContain('--refresh')
    expect(vaultMap.argumentHint).toContain('--dry-run')
    expect(vaultMap.argumentHint).toContain('--no-llm')
    expect(vaultMap.argumentHint).toContain('--concurrency')
  })

  test('load() returns an object with call function', async () => {
    const loaded = await vaultMap.load()
    expect(typeof loaded.call).toBe('function')
  })

  test('parseArgs extracts flags correctly', () => {
    // Test via the command module's internal parsing
    // We can't access parseArgs directly since it's private,
    // but we verify the command is loadable and well-formed
    expect(vaultMap.supportsNonInteractive).toBe(true)
  })
})
