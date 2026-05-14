import { describe, it, expect } from 'bun:test'
import { UNIT_TEST_TOOL_NAME } from './prompt.js'
import { UnitTestTool } from './UnitTestTool.js'

describe('UnitTestTool', () => {
  it('has the correct name', () => { expect(UnitTestTool.name).toBe(UNIT_TEST_TOOL_NAME) })
  it('has a non-empty description', async () => { expect((await UnitTestTool.description()).length).toBeGreaterThan(0) })
  it('has isEnabled from buildTool', () => { expect(UnitTestTool.isEnabled()).toBe(true) })
  it('is not read-only', () => { expect(UnitTestTool.isReadOnly?.()).toBe(false) })
  it('asks permission for execution', async () => {
    const p = await UnitTestTool.checkPermissions!({ framework: 'bun', path: '.' })
    expect(p.behavior).toBe('ask')
  })
  it('rejects timeout < 1', async () => { expect((await UnitTestTool.validateInput({ timeout: 0 })).result).toBe(false) })
  it('has mapToolResultToToolResultBlockParam', () => {
    const b = UnitTestTool.mapToolResultToToolResultBlockParam({ success: true, framework: 'bun', passed: 10, failed: 0, total: 10, durationMs: 100 }, 't1')
    expect(b.tool_use_id).toBe('t1'); expect(b.type).toBe('tool_result')
  })
  it('renders tool use message', () => { expect(UnitTestTool.renderToolUseMessage?.({ framework: 'jest', path: 'src/' })).toContain('jest') })
  it('renders success result', () => { expect(UnitTestTool.renderToolResultMessage?.({ success: true, framework: 'bun', passed: 42, failed: 0, total: 42, durationMs: 1500 })).toContain('42/42') })
  it('renders failure result', () => { expect(UnitTestTool.renderToolResultMessage?.({ success: false, framework: 'jest', passed: 40, failed: 2, total: 42, durationMs: 2000, error: '2 tests failed' })).toContain('2 tests failed') })
  it('renders no-tests result', () => { expect(UnitTestTool.renderToolResultMessage?.({ success: true, framework: 'pytest', passed: 0, failed: 0, total: 0, durationMs: 500 })).toContain('No tests found') })
  it('renders success with coverage', () => { expect(UnitTestTool.renderToolResultMessage?.({ success: true, framework: 'vitest', passed: 50, failed: 0, total: 50, durationMs: 3000, coverage: { lines: 85 } })).toContain('85%') })
  it('provides auto-classifier input', () => { expect(UnitTestTool.toAutoClassifierInput?.({ framework: 'jest', path: 'src/', filter: 'auth' })).toBe('jest: auth') })
})
