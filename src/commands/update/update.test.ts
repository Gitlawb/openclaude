import { describe, expect, test } from 'bun:test'

async function importFreshUpdateCommand() {
  return import(`./update.js?ts=${Date.now()}-${Math.random()}`)
}

async function withAsyncMockMacro<T>(
  macro: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const originalMacro = (globalThis as Record<string, unknown>).MACRO
  ;(globalThis as Record<string, unknown>).MACRO = macro

  try {
    return await run()
  } finally {
    if (originalMacro === undefined) {
      delete (globalThis as Record<string, unknown>).MACRO
    } else {
      ;(globalThis as Record<string, unknown>).MACRO = originalMacro
    }
  }
}

describe('removeStaleNativeLauncherForNpmUpdate', () => {
  test('removes stale native launchers for npm-only builds before npm update', async () => {
    let removed = 0

    await withAsyncMockMacro({ PACKAGE_URL: '@gitlawb/openclaude' }, async () => {
      const { removeStaleNativeLauncherForNpmUpdate } =
        await importFreshUpdateCommand()
      await expect(
        removeStaleNativeLauncherForNpmUpdate({
          getConfig: () => ({ installMethod: 'native' }),
          hasNativeDistribution: () => false,
          removeInstalledSymlink: async () => {
            removed++
          },
        }),
      ).resolves.toBe(true)
    })

    expect(removed).toBe(1)
  })

  test('preserves native launchers for native-capable builds', async () => {
    let removed = 0

    await withAsyncMockMacro({ PACKAGE_URL: '@gitlawb/openclaude' }, async () => {
      const { removeStaleNativeLauncherForNpmUpdate } =
        await importFreshUpdateCommand()
      await expect(
        removeStaleNativeLauncherForNpmUpdate({
          getConfig: () => ({ installMethod: 'native' }),
          hasNativeDistribution: () => true,
          removeInstalledSymlink: async () => {
            removed++
          },
        }),
      ).resolves.toBe(false)
    })

    expect(removed).toBe(0)
  })

  test('keeps existing cleanup for non-native config states', async () => {
    let removed = 0

    await withAsyncMockMacro({ PACKAGE_URL: '@gitlawb/openclaude' }, async () => {
      const { removeStaleNativeLauncherForNpmUpdate } =
        await importFreshUpdateCommand()
      await expect(
        removeStaleNativeLauncherForNpmUpdate({
          getConfig: () => ({ installMethod: 'global' }),
          hasNativeDistribution: () => true,
          removeInstalledSymlink: async () => {
            removed++
          },
        }),
      ).resolves.toBe(true)
    })

    expect(removed).toBe(1)
  })
})
