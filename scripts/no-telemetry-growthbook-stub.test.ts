import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Setup: dynamically import the source-level growthbook no-op stub.
// The stub reads ~/.claude/feature-flags.json for local flag overrides.
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `growthbook-stub-test-${process.pid}`)
const flagsFile = join(testDir, 'test-flags.json')

mkdirSync(testDir, { recursive: true })

// Point the stub at our test flags file before import
process.env.CLAUDE_FEATURE_FLAGS_FILE = flagsFile

const stub = await import('../src/services/analytics/growthbook.js')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('growthbook stub — local feature flag overrides', () => {
  beforeEach(() => {
    stub.resetGrowthBook()
    try { unlinkSync(flagsFile) } catch { /* may not exist */ }
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
    delete process.env.CLAUDE_FEATURE_FLAGS_FILE
  })

  // ── File absent ──────────────────────────────────────────────────

  test('returns defaultValue when flags file is absent', () => {
    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_foo', 42)).toBe(42)
  })

  test('getAllGrowthBookFeatures returns {} when file is absent', () => {
    expect(stub.getAllGrowthBookFeatures()).toEqual({})
  })

  // ── Valid JSON object ────────────────────────────────────────────

  test('loads and returns values from a valid JSON file', () => {
    writeFileSync(flagsFile, JSON.stringify({ tengu_foo: true, tengu_bar: 'hello' }))

    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_foo', false)).toBe(true)
    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_bar', 'default')).toBe('hello')
  })

  test('returns defaultValue for keys not present in the file', () => {
    writeFileSync(flagsFile, JSON.stringify({ tengu_foo: true }))

    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_missing', 99)).toBe(99)
  })

  test('getAllGrowthBookFeatures returns the full flags object', () => {
    const flags = { tengu_a: true, tengu_b: false, tengu_c: 42 }
    writeFileSync(flagsFile, JSON.stringify(flags))

    expect(stub.getAllGrowthBookFeatures()).toEqual(flags)
  })

  // ── Malformed / non-object JSON ──────────────────────────────────

  test('falls back to defaults on malformed JSON', () => {
    writeFileSync(flagsFile, '{not valid json!!!')

    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_foo', 'fallback')).toBe('fallback')
  })

  test('falls back to defaults when JSON is a primitive (true)', () => {
    writeFileSync(flagsFile, 'true')

    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_foo', 'fallback')).toBe('fallback')
  })

  test('falls back to defaults when JSON is an array', () => {
    writeFileSync(flagsFile, '["a", "b"]')

    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_foo', 'fallback')).toBe('fallback')
  })

  // ── Cache invalidation ───────────────────────────────────────────

  test('resetGrowthBook clears cache so the file is re-read', () => {
    writeFileSync(flagsFile, JSON.stringify({ tengu_foo: 'first' }))
    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_foo', 'x')).toBe('first')

    // Update the file — cached value is still 'first'
    writeFileSync(flagsFile, JSON.stringify({ tengu_foo: 'second' }))
    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_foo', 'x')).toBe('first')

    // After reset, the new value is picked up
    stub.resetGrowthBook()
    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_foo', 'x')).toBe('second')
  })

  // ── Security gate ────────────────────────────────────────────────

  test('checkSecurityRestrictionGate always returns false regardless of flags', async () => {
    writeFileSync(flagsFile, JSON.stringify({
      tengu_disable_bypass_permissions_mode: true,
    }))

    expect(await stub.checkSecurityRestrictionGate('tengu_disable_bypass_permissions_mode')).toBe(false)
  })

  // ── All getter variants return default ───────────────────────────

  test('all getter functions return default values when no flags file', async () => {
    expect(stub.getFeatureValue_DEPRECATED('tengu_gate', false)).toBe(false)
    expect(stub.getFeatureValue_CACHED_WITH_REFRESH('tengu_gate', false)).toBe(false)
    expect(stub.checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_gate')).toBe(false)
    expect(await stub.checkGate_CACHED_OR_BLOCKING('tengu_gate')).toBe(false)
    expect(await stub.getDynamicConfig_BLOCKS_ON_INIT('tengu_config', {})).toEqual({})
    expect(stub.getDynamicConfig_CACHED_MAY_BE_STALE('tengu_config', {})).toEqual({})
  })

  // ── Gate helpers route through _getFlagValue ──────────────────────────

  test('checkStatsigFeatureGate_CACHED_MAY_BE_STALE returns false when file is absent', () => {
    expect(stub.checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_gate')).toBe(false)
  })

  test('checkStatsigFeatureGate_CACHED_MAY_BE_STALE returns true from flags file', () => {
    writeFileSync(flagsFile, JSON.stringify({ tengu_gate: true }))
    expect(stub.checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_gate')).toBe(true)
  })

  test('checkGate_CACHED_OR_BLOCKING returns false when file is absent', async () => {
    expect(await stub.checkGate_CACHED_OR_BLOCKING('tengu_bridge')).toBe(false)
  })

  test('checkGate_CACHED_OR_BLOCKING returns true from flags file', async () => {
    writeFileSync(flagsFile, JSON.stringify({ tengu_bridge: true }))
    expect(await stub.checkGate_CACHED_OR_BLOCKING('tengu_bridge')).toBe(true)
  })

  test('checkSecurityRestrictionGate always returns false regardless of flags', async () => {
    writeFileSync(flagsFile, JSON.stringify({ tengu_disable_bypass_permissions_mode: true }))
    expect(await stub.checkSecurityRestrictionGate('tengu_disable_bypass_permissions_mode')).toBe(false)
  })
})