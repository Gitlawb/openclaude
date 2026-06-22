import { afterEach, describe, expect, mock, test } from 'bun:test'

const mockPush = mock<(state: any) => Promise<any>>()

let resolvePush: (() => void) | null = null

mock.module('./index.js', () => ({
  createSyncState: () => ({ lastKnownChecksum: null, serverChecksums: new Map(), serverMaxEntries: null }),
  pushTeamMemory: mockPush,
  pullTeamMemory: async () => ({ success: true, filesWritten: 0, entryCount: 0 }),
  isTeamMemorySyncAvailable: () => true,
}))

type WatcherModule = typeof import('./watcher.js')
let mod: WatcherModule

async function freshMod(): Promise<WatcherModule> {
  const m = await import(`./watcher.js?test=${Date.now()}-${Math.random()}`)
  m._resetWatcherStateForTesting({ syncState: { lastKnownChecksum: null, serverChecksums: new Map(), serverMaxEntries: null } })
  return m
}

afterEach(() => {
  resolvePush = null
  mockPush.mockReset()
})

function hangPush(): void {
  mockPush.mockImplementation(() => new Promise(resolve => {
    resolvePush = () => resolve({ success: true, filesUploaded: 0 })
  }))
}

function immediatePush(): void {
  mockPush.mockImplementation(() => Promise.resolve({ success: true, filesUploaded: 0 }))
}

describe('rescheduleCount behavior', () => {
  test('increments while push in flight and resets after cap via onDebounceFire', async () => {
    mod = await freshMod()
    hangPush()

    mod._test.pushInProgress = true

    for (let i = 0; i < mod._test.MAX_RESCHEDULE_ATTEMPTS; i++) {
      mod._test.onDebounceFire()
    }
    expect(mod._test.rescheduleCount).toBe(mod._test.MAX_RESCHEDULE_ATTEMPTS)

    mod._test.onDebounceFire()
    expect(mod._test.rescheduleCount).toBe(0)

    mod._test.pushInProgress = false
    mod._resetWatcherStateForTesting()
  })

  test('resets to 0 when executePush completes', async () => {
    mod = await freshMod()
    hangPush()

    mod._test.executePush()
    expect(mod._test.pushInProgress).toBe(true)

    resolvePush!()
    await Promise.resolve()
    await Promise.resolve()

    expect(mod._test.pushInProgress).toBe(false)
    expect(mod._test.rescheduleCount).toBe(0)
  })

  test('capped reschedule chains follow-up push after in-flight push completes', async () => {
    mod = await freshMod()
    let callCount = 0
    let resolveFirst!: (v: unknown) => void
    mockPush.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return new Promise(resolve => { resolveFirst = resolve })
      }
      return Promise.resolve({ success: true, filesUploaded: 0 })
    })

    const firstPush = mod._test.executePush()
    expect(mod._test.pushInProgress).toBe(true)

    mod._test.currentPushPromise = (mod._test.currentPushPromise ?? Promise.resolve()).then(
      () => mod._test.executePush(),
    )

    expect(callCount).toBe(1)

    resolveFirst({ success: true, filesUploaded: 0 })
    await firstPush
    await mod._test.currentPushPromise

    expect(mod._test.pushInProgress).toBe(false)
    expect(callCount).toBe(2)
  })
})

describe('executePush identity safety', () => {
  test('clears currentPushPromise when it was null before execution', async () => {
    immediatePush()
    mod = await freshMod()
    mod._resetWatcherStateForTesting({ syncState: { lastKnownChecksum: null, serverChecksums: new Map(), serverMaxEntries: null } })

    expect(mod._test.currentPushPromise).toBeNull()
    await mod._test.executePush()

    expect(mod._test.pushInProgress).toBe(false)
    expect(mod._test.currentPushPromise).toBeNull()
  })

  test('preserves currentPushPromise when replaced during yield point', async () => {
    immediatePush()
    mod = await freshMod()
    mod._resetWatcherStateForTesting({ syncState: { lastKnownChecksum: null, serverChecksums: new Map(), serverMaxEntries: null } })

    const replacement: Promise<void> = Promise.resolve()

    const pushP = mod._test.executePush()

    mod._test.currentPushPromise = replacement

    await pushP

    expect(mod._test.pushInProgress).toBe(false)
    expect(mod._test.currentPushPromise).toBe(replacement)
  })
})
