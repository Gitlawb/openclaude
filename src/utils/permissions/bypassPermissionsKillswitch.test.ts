import { afterEach, describe, expect, test } from 'bun:test'

import {
  checkAndDisableBypassPermissionsIfNeeded,
  resetBypassPermissionsCheck,
} from './bypassPermissionsKillswitch.js'

afterEach(() => {
  resetBypassPermissionsCheck()
})

describe('checkAndDisableBypassPermissionsIfNeeded', () => {
  test('does not latch the run-once guard before dangerous mode becomes available', async () => {
    let gateChecks = 0

    await checkAndDisableBypassPermissionsIfNeeded(
      {
        isBypassPermissionsModeAvailable: false,
      } as never,
      () => {},
      {
        createDisabledBypassPermissionsContext: context => context,
        shouldDisableBypassPermissions: async () => {
          gateChecks += 1
          return false
        },
      },
    )

    expect(gateChecks).toBe(0)

    await checkAndDisableBypassPermissionsIfNeeded(
      {
        isBypassPermissionsModeAvailable: true,
      } as never,
      () => {},
      {
        createDisabledBypassPermissionsContext: context => context,
        shouldDisableBypassPermissions: async () => {
          gateChecks += 1
          return false
        },
      },
    )

    expect(gateChecks).toBe(1)
  })

  test('shares the in-flight authoritative check between startup and first query', async () => {
    let gateChecks = 0
    let disabledContexts = 0
    let appStateUpdates = 0
    let resolveGateCheck: ((value: boolean) => void) | undefined

    const context = {
      isBypassPermissionsModeAvailable: true,
    } as never

    const setAppState = (
      update: (prev: { toolPermissionContext: typeof context }) => unknown,
    ) => {
      appStateUpdates += 1
      update({
        toolPermissionContext: context,
      })
    }

    const deps = {
      createDisabledBypassPermissionsContext: (
        currentContext: typeof context,
      ) => {
        disabledContexts += 1
        return currentContext
      },
      shouldDisableBypassPermissions: () => {
        gateChecks += 1
        return new Promise<boolean>(resolve => {
          resolveGateCheck = resolve
        })
      },
    }

    const startupCheck = checkAndDisableBypassPermissionsIfNeeded(
      context,
      setAppState,
      deps,
    )
    const firstQueryCheck = checkAndDisableBypassPermissionsIfNeeded(
      context,
      setAppState,
      deps,
    )

    expect(gateChecks).toBe(1)

    resolveGateCheck?.(true)
    await Promise.all([startupCheck, firstQueryCheck])

    expect(disabledContexts).toBe(1)
    expect(appStateUpdates).toBe(1)
  })
})
