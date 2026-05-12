import { describe, it, expect } from 'bun:test'
import { UNIT_TEST_TOOL_NAME } from './prompt.js'
import { UnitTestTool } from './UnitTestTool.js'

describe('UnitTestTool', () => {
  it('has the correct name', () => {
    expect(UnitTestTool.name).toBe(UNIT_TEST_TOOL_NAME)
  })

  it('has a non-empty description', async () => {
    expect((await UnitTestTool.description()).length).toBeGreaterThan(0)
  })

  it('is not read-only (tests can write snapshots/coverage)', () => {
    expect(UnitTestTool.isReadOnly?.()).toBe(false)
  })

  it('asks permission for execution', async () => {
    const perm = await UnitTestTool.checkPermissions!({ framework: 'bun', path: '.' })
    expect(perm.behavior).toBe('ask')
  })

  it('accepts valid input', async () => {
    expect((await UnitTestTool.validateInput({ framework: 'bun' })).result).toBe(true)
  })

  it('rejects timeout < 1', async () => {
    expect((await UnitTestTool.validateInput({ timeout: 0 })).result).toBe(false)
  })

  it('rejects timeout > 3600', async () => {
    expect((await UnitTestTool.validateInput({ timeout: 3601 })).result).toBe(false)
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const block = UnitTestTool.mapToolResultToToolResultBlockParam({ success: true, framework: 'bun', passed: 10, failed: 0, total: 10, durationMs: 100 }, 't1')
    expect(block.tool_use_id).toBe('t1')
    expect(block.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const msg = UnitTestTool.renderToolUseMessage?.({ framework: 'jest', path: 'src/' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('jest')
  })

  it('renders success result', () => {
    const msg = UnitTestTool.renderToolResultMessage?.({ success: true, framework: 'bun', passed: 42, failed: 0, total: 42, durationMs: 1500 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('42/42')
  })

  it('renders failure result with error', () => {
    const msg = UnitTestTool.renderToolResultMessage?.({ success: false, framework: 'jest', passed: 40, failed: 2, total: 42, durationMs: 2000, error: '2 tests failed' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('2 tests failed')
  })

  it('renders no-tests result', () => {
    const msg = UnitTestTool.renderToolResultMessage?.({ success: true, framework: 'pytest', passed: 0, failed: 0, total: 0, durationMs: 500 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('No tests found')
  })

  it('renders success with coverage', () => {
    const msg = UnitTestTool.renderToolResultMessage?.({ success: true, framework: 'vitest', passed: 50, failed: 0, total: 50, durationMs: 3000, coverage: { lines: 85 } })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('85%')
  })

  it('provides auto-classifier input', () => {
    expect(UnitTestTool.toAutoClassifierInput?.({ framework: 'jest', path: 'src/', filter: 'auth' })).toBe('jest: auth')
  })
})
