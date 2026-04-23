import { describe, test, expect } from 'bun:test'
import {
  buildPermissionContext,
  createDefaultCanUseTool,
} from '../../src/entrypoints/sdk/permissions.js'
import { getEmptyToolPermissionContext } from '../../src/Tool.js'

describe('buildPermissionContext', () => {
  test('returns default mode when no permissionMode specified', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp' })
    expect(ctx.mode).toBe('default')
  })

  test('maps plan mode correctly', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', permissionMode: 'plan' })
    expect(ctx.mode).toBe('plan')
  })

  test('maps auto-accept to acceptEdits', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', permissionMode: 'auto-accept' })
    expect(ctx.mode).toBe('acceptEdits')
  })

  test('maps acceptEdits mode', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', permissionMode: 'acceptEdits' })
    expect(ctx.mode).toBe('acceptEdits')
  })

  test('maps bypass-permissions mode', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', permissionMode: 'bypass-permissions' })
    expect(ctx.mode).toBe('bypassPermissions')
    expect(ctx.isBypassPermissionsModeAvailable).toBe(true)
  })

  test('maps bypassPermissions mode', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', permissionMode: 'bypassPermissions' })
    expect(ctx.mode).toBe('bypassPermissions')
    expect(ctx.isBypassPermissionsModeAvailable).toBe(true)
  })

  test('default mode does not have bypass available', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp' })
    expect(ctx.isBypassPermissionsModeAvailable).toBe(false)
  })

  test('allowDangerouslySkipPermissions sets bypass flag', () => {
    const ctx = buildPermissionContext({
      cwd: '/tmp',
      allowDangerouslySkipPermissions: true,
    })
    expect(ctx.isBypassPermissionsModeAvailable).toBe(true)
  })

  test('additionalDirectories are added to context', () => {
    const ctx = buildPermissionContext({
      cwd: '/tmp',
      additionalDirectories: ['/dir1', '/dir2'],
    })
    expect(ctx.additionalWorkingDirectories.has('/dir1')).toBe(true)
    expect(ctx.additionalWorkingDirectories.has('/dir2')).toBe(true)
  })

  test('empty additionalDirectories does nothing', () => {
    const ctx = buildPermissionContext({ cwd: '/tmp', additionalDirectories: [] })
    expect(ctx.additionalWorkingDirectories.size).toBe(0)
  })
})

describe('createDefaultCanUseTool', () => {
  test('denies all tool uses', async () => {
    const ctx = getEmptyToolPermissionContext()
    const canUseTool = createDefaultCanUseTool(ctx)

    const result = await canUseTool(
      { name: 'Bash' } as any,
      { command: 'rm -rf /' },
      {} as any,
      {} as any,
      undefined,
      undefined,
    )

    expect(result.behavior).toBe('deny')
  })

  test('honors forceDecision when provided', async () => {
    const ctx = getEmptyToolPermissionContext()
    const canUseTool = createDefaultCanUseTool(ctx)

    const forced = { behavior: 'allow' as const }
    const result = await canUseTool(
      { name: 'Bash' } as any,
      {},
      {} as any,
      {} as any,
      undefined,
      forced,
    )

    expect(result.behavior).toBe('allow')
  })
})
