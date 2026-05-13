import { describe, it, expect } from 'bun:test'
import { PACKAGE_MANAGER_TOOL_NAME } from './prompt.js'
import { PackageManagerTool } from './PackageManagerTool.js'

describe('PackageManagerTool', () => {
  it('has the correct name', () => {
    expect(PackageManagerTool.name).toBe(PACKAGE_MANAGER_TOOL_NAME)
  })

  it('has a non-empty description', async () => {
    expect((await PackageManagerTool.description()).length).toBeGreaterThan(0)
  })

  it('marks list as read-only', () => {
    expect(PackageManagerTool.isReadOnly?.({ action: 'list' })).toBe(true)
  })

  it('marks install as not read-only', () => {
    expect(PackageManagerTool.isReadOnly?.({ action: 'install' })).toBe(false)
  })

  it('marks remove as destructive', () => {
    expect(PackageManagerTool.isDestructive?.({ action: 'remove' })).toBe(true)
  })

  it('marks audit as not destructive', () => {
    expect(PackageManagerTool.isDestructive?.({ action: 'audit' })).toBe(false)
  })

  it('requires packages for install', async () => {
    expect((await PackageManagerTool.validateInput({ action: 'install' })).result).toBe(false)
  })

  it('accepts list without packages', async () => {
    expect((await PackageManagerTool.validateInput({ action: 'list' })).result).toBe(true)
  })

  it('asks permission for install', async () => {
    const perm = await PackageManagerTool.checkPermissions!({ action: 'install', packages: ['lodash'] })
    expect(perm.behavior).toBe('ask')
  })

  it('asks permission for audit (network/remote code)', async () => {
    const perm = await PackageManagerTool.checkPermissions!({ action: 'audit' })
    expect(perm.behavior).toBe('ask')
  })

  it('has mapToolResultToToolResultBlockParam', () => {
    const block = PackageManagerTool.mapToolResultToToolResultBlockParam({ success: true, manager: 'npm', action: 'list', output: '', durationMs: 100 }, 'tid')
    expect(block.tool_use_id).toBe('tid')
    expect(block.type).toBe('tool_result')
  })

  it('renders tool use message', () => {
    const msg = PackageManagerTool.renderToolUseMessage?.({ manager: 'npm', action: 'install', packages: ['lodash'] })
    expect(msg).toContain('npm install lodash')
  })

  it('renders success result', () => {
    const msg = PackageManagerTool.renderToolResultMessage?.({ success: true, manager: 'npm', action: 'list', output: '', durationMs: 500 })
    expect(msg).toContain('npm list succeeded')
  })

  it('renders error result', () => {
    const msg = PackageManagerTool.renderToolResultMessage?.({ success: false, manager: 'npm', action: 'install', output: '', durationMs: 100, error: 'EACCES: permission denied' })
    expect(msg).toContain('EACCES')
  })

  it('provides auto-classifier input', () => {
    expect(PackageManagerTool.toAutoClassifierInput?.({ action: 'install', packages: ['lodash'] })).toBe('auto install lodash')
  })
})
