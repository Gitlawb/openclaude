import { describe, expect, it } from 'bun:test'
import {
  startBackgroundHousekeeping,
  startBackgroundSessionReconciliation,
} from './backgroundHousekeeping.js'

describe('background session housekeeping', () => {
  it('starts recurring background-session reconciliation', async () => {
    let callback: (() => void) | undefined
    let runs = 0
    startBackgroundHousekeeping({
      backgroundSessionReconciliation: {
        cleanup: async () => {
          runs++
        },
        setInterval: scheduledCallback => {
          callback = scheduledCallback
          return { unref: () => {} }
        },
      },
      _reconciliationOnlyForTesting: true,
    })

    callback?.()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(runs).toBe(1)
  })

  it('runs recurring reconciliation without overlapping passes', async () => {
    let callback: (() => void) | undefined
    let intervalMs: number | undefined
    let unrefCalls = 0
    let runs = 0
    let releaseFirstRun!: () => void
    const firstRun = new Promise<void>(resolve => {
      releaseFirstRun = resolve
    })

    startBackgroundSessionReconciliation({
      cleanup: async () => {
        runs++
        if (runs === 1) await firstRun
      },
      setInterval: (scheduledCallback, scheduledIntervalMs) => {
        callback = scheduledCallback
        intervalMs = scheduledIntervalMs
        return {
          unref: () => {
            unrefCalls++
          },
        }
      },
    })

    expect(intervalMs).toBe(60_000)
    expect(unrefCalls).toBe(1)
    callback?.()
    callback?.()
    await Promise.resolve()
    expect(runs).toBe(1)

    releaseFirstRun()
    await firstRun
    await new Promise(resolve => setTimeout(resolve, 0))
    callback?.()
    await Promise.resolve()
    expect(runs).toBe(2)
  })
})
