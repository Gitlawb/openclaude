import { describe, it, expect } from 'bun:test'
import { COVERAGE_TOOL_NAME } from './prompt.js'
import { CoverageTool } from './CoverageTool.js'

describe('CoverageTool', () => {
  it('has the correct name', () => {
    expect(CoverageTool.name).toBe(COVERAGE_TOOL_NAME)
  })

  it('has a non-empty description', async () => {
    expect((await CoverageTool.description()).length).toBeGreaterThan(0)
  })

  it('is always read-only', () => {
    expect(CoverageTool.isReadOnly?.()).toBe(true)
  })

  it('validates always passes', async () => {
    expect((await CoverageTool.validateInput({})).result).toBe(true)
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const block = CoverageTool.mapToolResultToToolResultBlockParam({ success: true, format: 'lcov', lines: 85, durationMs: 100 }, 't1')
    expect(block.tool_use_id).toBe('t1')
    expect(block.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const msg = CoverageTool.renderToolUseMessage?.({ path: '.' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('Reading')
  })

  it('renders success result', () => {
    const msg = CoverageTool.renderToolResultMessage?.({ success: true, format: 'lcov', lines: 72.5, durationMs: 200 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('72.5% lines')
  })

  it('renders with branches', () => {
    const msg = CoverageTool.renderToolResultMessage?.({ success: true, format: 'lcov', lines: 85, branches: 70, durationMs: 300 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('70% branches')
  })

  it('renders uncovered files', () => {
    const msg = CoverageTool.renderToolResultMessage?.({ success: true, format: 'lcov', lines: 60, uncoveredFiles: ['a.ts'], durationMs: 100 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('1 files with 0%')
  })

  it('renders threshold met', () => {
    const msg = CoverageTool.renderToolResultMessage?.({ success: true, format: 'lcov', lines: 85, meetsThreshold: true, durationMs: 100 })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('✅ meets threshold')
  })

  it('renders error result', () => {
    const msg = CoverageTool.renderToolResultMessage?.({ success: false, format: 'lcov', lines: 0, durationMs: 5, error: 'report not found' })
    expect(msg).toBeDefined()
    if (msg && 'text' in msg) expect(msg.text).toContain('report not found')
  })

  it('provides auto-classifier input', () => {
    expect(CoverageTool.toAutoClassifierInput?.({ format: 'lcov', path: '.' })).toBe('lcov .')
  })
})
