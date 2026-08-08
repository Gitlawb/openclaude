import { describe, expect, test } from 'bun:test'

describe('SettingsSchema worktree settings', () => {
  test('accepts autoConfigureLongPaths setting', async () => {
    const { SettingsSchema } = await import('./types.js')

    const result = SettingsSchema().safeParse({
      worktree: {
        autoConfigureLongPaths: false,
      },
    })

    expect(result.success).toBe(true)
    expect(result.data?.worktree?.autoConfigureLongPaths).toBe(false)
  })

  test('normalizes legacy enableGitLongPaths to autoConfigureLongPaths', async () => {
    const { SettingsSchema } = await import('./types.js')

    const result = SettingsSchema().safeParse({
      worktree: {
        enableGitLongPaths: false,
      },
    })

    expect(result.success).toBe(true)
    expect(result.data?.worktree?.autoConfigureLongPaths).toBe(false)
    expect(result.data?.worktree?.enableGitLongPaths).toBe(false)
  })

  test('gives precedence to autoConfigureLongPaths when both are defined', async () => {
    const { SettingsSchema } = await import('./types.js')

    const result = SettingsSchema().safeParse({
      worktree: {
        autoConfigureLongPaths: true,
        enableGitLongPaths: false,
      },
    })

    expect(result.success).toBe(true)
    expect(result.data?.worktree?.autoConfigureLongPaths).toBe(true)
  })
})
