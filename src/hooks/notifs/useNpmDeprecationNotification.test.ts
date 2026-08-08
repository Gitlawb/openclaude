import { describe, expect, test } from 'bun:test'
import { getNpmDeprecationNotification } from './npmDeprecationNotification.js'

describe('getNpmDeprecationNotification', () => {
  test('does not advertise native install when the build has no native distribution', async () => {
    await expect(
      getNpmDeprecationNotification({
        hasNativeDistribution: () => false,
        getInstallationType: async () => 'npm-global',
      }),
    ).resolves.toBeNull()
  })

  test('keeps the warning for native-capable npm builds', async () => {
    const notification = await getNpmDeprecationNotification({
      hasNativeDistribution: () => true,
      getInstallationType: async () => 'npm-global',
      isBundledMode: () => false,
      installationChecksDisabled: () => false,
    })

    expect(notification).toMatchObject({
      key: 'npm-deprecation-warning',
      priority: 'high',
    })
  })

  test('suppresses the warning in bundled mode', async () => {
    await expect(
      getNpmDeprecationNotification({
        hasNativeDistribution: () => true,
        isBundledMode: () => true,
        installationChecksDisabled: () => false,
        getInstallationType: async () => 'npm-global',
      }),
    ).resolves.toBeNull()
  })

  test('suppresses the warning when installation checks are disabled', async () => {
    await expect(
      getNpmDeprecationNotification({
        hasNativeDistribution: () => true,
        isBundledMode: () => false,
        installationChecksDisabled: () => true,
        getInstallationType: async () => 'npm-global',
      }),
    ).resolves.toBeNull()
  })

  test('suppresses the warning for development installations', async () => {
    await expect(
      getNpmDeprecationNotification({
        hasNativeDistribution: () => true,
        isBundledMode: () => false,
        installationChecksDisabled: () => false,
        getInstallationType: async () => 'development',
      }),
    ).resolves.toBeNull()
  })
})
