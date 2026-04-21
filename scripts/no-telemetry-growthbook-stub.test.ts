import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// Setup: extract the growthbook stub from no-telemetry-plugin.ts, write it to
// a temp .mjs file, and dynamically import it so we can test the real code
// that gets bundled.
// ---------------------------------------------------------------------------

const pluginSource = readFileSync(join(__dirname, 'no-telemetry-plugin.ts'), 'utf-8')
const stubMatch = pluginSource.match(/'services\/analytics\/growthbook': `([\s\S]*?)`/)
if (!stubMatch) throw new Error('Could not extract growthbook stub from no-telemetry-plugin.ts')

const testDir = join(tmpdir(), `growthbook-stub-test-${process.pid}`)
const stubFile = join(testDir, 'growthbook-stub.mjs')
const flagsFile = join(testDir, 'test-flags.json')

mkdirSync(testDir, { recursive: true })
writeFileSync(stubFile, stubMatch[1])

// Point the stub at our test flags file (checked by _loadFlags on first access)
process.env.CLAUDE_FEATURE_FLAGS_FILE = flagsFile

const stub = await import(stubFile)

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

  // ── Open-build defaults (_openBuildDefaults) ────────────────────

  test('returns open-build default when flags file is absent', () => {
    // tengu_passport_quail is in _openBuildDefaults as true; without a
    // flags file the stub should return the open-build override, not
    // the call-site defaultValue.
    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_passport_quail', false)).toBe(true)
    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_coral_fern', false)).toBe(true)
  })

  test('flags file overrides open-build defaults', () => {
    // User-provided feature-flags.json takes priority over _openBuildDefaults.
    writeFileSync(flagsFile, JSON.stringify({ tengu_passport_quail: false }))

    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_passport_quail', true)).toBe(false)
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

  test('refreshGrowthBookFeatures clears cache', async () => {
    writeFileSync(flagsFile, JSON.stringify({ tengu_foo: 'v1' }))
    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_foo', 'x')).toBe('v1')

    writeFileSync(flagsFile, JSON.stringify({ tengu_foo: 'v2' }))
    await stub.refreshGrowthBookFeatures()
    expect(stub.getFeatureValue_CACHED_MAY_BE_STALE('tengu_foo', 'x')).toBe('v2')
  })

  // ── Multiple getter variants ─────────────────────────────────────

  test('all getter functions read from local flags', async () => {
    writeFileSync(flagsFile, JSON.stringify({ tengu_gate: true, tengu_config: { a: 1 } }))

    expect(await stub.getFeatureValue_DEPRECATED('tengu_gate', false)).toBe(true)
    stub.resetGrowthBook()
    expect(stub.getFeatureValue_CACHED_WITH_REFRESH('tengu_gate', false)).toBe(true)
    stub.resetGrowthBook()
    expect(stub.checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_gate')).toBe(true)
    stub.resetGrowthBook()
    expect(await stub.checkGate_CACHED_OR_BLOCKING('tengu_gate')).toBe(true)
    stub.resetGrowthBook()
    expect(await stub.getDynamicConfig_BLOCKS_ON_INIT('tengu_config', {})).toEqual({ a: 1 })
    stub.resetGrowthBook()
    expect(stub.getDynamicConfig_CACHED_MAY_BE_STALE('tengu_config', {})).toEqual({ a: 1 })
  })

  // ── Security gate ────────────────────────────────────────────────

  test('checkSecurityRestrictionGate always returns false regardless of flags', async () => {
    writeFileSync(flagsFile, JSON.stringify({
      tengu_disable_bypass_permissions_mode: true,
    }))

    expect(await stub.checkSecurityRestrictionGate()).toBe(false)
  })
})
