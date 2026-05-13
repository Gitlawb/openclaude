import { describe, it, expect } from 'bun:test'
import { FILE_ARCHIVE_TOOL_NAME } from './prompt.js'
import { FileArchiveTool } from './FileArchiveTool.js'

describe('FileArchiveTool', () => {
  it('has the correct name', () => { expect(FileArchiveTool.name).toBe(FILE_ARCHIVE_TOOL_NAME) })
  it('has a non-empty description', async () => { expect((await FileArchiveTool.description()).length).toBeGreaterThan(0) })
  it('has isEnabled from buildTool', () => { expect(FileArchiveTool.isEnabled()).toBe(true) })

  it('marks list as read-only', () => { expect(FileArchiveTool.isReadOnly?.({ action: 'list' })).toBe(true) })
  it('marks create as not read-only', () => { expect(FileArchiveTool.isReadOnly?.({ action: 'create' })).toBe(false) })

  it('requires destination for extract', async () => { expect((await FileArchiveTool.validateInput({ action: 'extract', source: 'a.zip' })).result).toBe(false) })
  it('accepts valid create input', async () => { expect((await FileArchiveTool.validateInput({ action: 'create', source: 'dir/' })).result).toBe(true) })

  it('has checkPermissions defined', () => {
    expect(typeof FileArchiveTool.checkPermissions).toBe('function')
  })

  it('has getPath defined', () => {
    expect(typeof FileArchiveTool.getPath).toBe('function')
    expect(FileArchiveTool.getPath?.({ source: 'test.zip' })).toBe('test.zip')
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const b = FileArchiveTool.mapToolResultToToolResultBlockParam({ success: true, action: 'list', format: 'zip', durationMs: 10 }, 'tid')
    expect(b.tool_use_id).toBe('tid'); expect(b.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const m = FileArchiveTool.renderToolUseMessage?.({ action: 'create', format: 'zip', source: 'src/', destination: 'out.zip' })
    if (m && 'text' in m) expect(m.text).toContain('create zip src/ → out.zip')
  })

  it('renders list result', () => {
    const m = FileArchiveTool.renderToolResultMessage?.({ success: true, action: 'list', format: 'zip', files: ['a.txt'], fileCount: 1, durationMs: 50 })
    if (m && 'text' in m) expect(m.text).toContain('1 files')
  })

  it('renders error result', () => {
    const m = FileArchiveTool.renderToolResultMessage?.({ success: false, action: 'create', format: 'zip', durationMs: 5, error: 'zip not found' })
    if (m && 'text' in m) expect(m.text).toContain('zip not found')
  })

  it('provides auto-classifier input', () => {
    expect(FileArchiveTool.toAutoClassifierInput?.({ action: 'list', format: 'zip', source: 'archive.zip' })).toBe('list zip archive.zip')
  })
})
