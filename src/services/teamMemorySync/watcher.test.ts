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

afterEach(async () => {
  if (resolvePush) {
    try {
      resolvePush()
    } catch {
      // ignore
    }
  }
  if (mod && mod._test.currentPushPromise) {
    try {
      await mod._test.currentPushPromise
    } catch {
      // ignore
    }
  }
  if (mod) {
    mod._resetWatcherStateForTesting()
  }
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

    mod._test.currentPushPromise = mod._test.executePush()
    expect(mod._test.pushInProgress).toBe(true)

    resolvePush!()
    await mod._test.currentPushPromise

    expect(mod._test.pushInProgress).toBe(false)
    expect(mod._test.rescheduleCount).toBe(0)
  })

  test('capped reschedule chains follow-up push after in-flight push completes', async () => {
    mod = await freshMod()
    let callCount = 0
    let resolveFirst!: (v: unknown) => void
    let firstPushStarted = false
    let secondPushStarted = false

    mockPush.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        firstPushStarted = true
        return new Promise(resolve => {
          resolveFirst = resolve
          resolvePush = () => resolve({ success: true, filesUploaded: 0 })
        })
      }
      if (callCount === 2) {
        secondPushStarted = true
        return Promise.resolve({ success: true, filesUploaded: 0 })
      }
      return Promise.resolve({ success: true, filesUploaded: 0 })
    })

    // Start first push
    mod._test.currentPushPromise = mod._test.executePush()
    expect(mod._test.pushInProgress).toBe(true)
    expect(callCount).toBe(1)
    expect(firstPushStarted).toBe(true)
    expect(secondPushStarted).toBe(false)

    // Trigger capped reschedule
    for (let i = 0; i <= mod._test.MAX_RESCHEDULE_ATTEMPTS; i++) {
      mod._test.onDebounceFire()
    }

    // Second push cannot start until the first resolves
    expect(secondPushStarted).toBe(false)
    expect(callCount).toBe(1)
    expect(mod._test.isFollowUpQueued).toBe(true)

    // Resolve first push
    resolveFirst({ success: true, filesUploaded: 0 })
    await mod._test.currentPushPromise

    // Second push has completed and state is cleaned up
    expect(secondPushStarted).toBe(true)
    expect(callCount).toBe(2)
    expect(mod._test.isFollowUpQueued).toBe(false)
    expect(mod._test.currentPushPromise).toBeNull()
  })

  test('does not queue multiple duplicate follow-up pushes when one is already queued', async () => {
    mod = await freshMod()
    let callCount = 0
    let resolveFirst!: (v: unknown) => void
    mockPush.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return new Promise(resolve => {
          resolveFirst = resolve
          resolvePush = () => resolve({ success: true, filesUploaded: 0 })
        })
      }
      return Promise.resolve({ success: true, filesUploaded: 0 })
    })

    // Start the first push
    mod._test.currentPushPromise = mod._test.executePush()
    expect(callCount).toBe(1)

    // Trigger first capped reschedule to queue the follow-up
    for (let i = 0; i <= mod._test.MAX_RESCHEDULE_ATTEMPTS; i++) {
      mod._test.onDebounceFire()
    }
    expect(mod._test.isFollowUpQueued).toBe(true)
    const followUpPromise = mod._test.currentPushPromise

    // Trigger second capped reschedule while follow-up is already queued
    for (let i = 0; i <= mod._test.MAX_RESCHEDULE_ATTEMPTS; i++) {
      mod._test.onDebounceFire()
    }
    // The currentPushPromise should remain the same promise instance (no new promise was chained/created)
    expect(mod._test.currentPushPromise).toBe(followUpPromise)

    // Resolve first push
    resolveFirst({ success: true, filesUploaded: 0 })
    await followUpPromise

    // Only 2 calls to push should have been made in total (the first push, and the single follow-up push)
    expect(callCount).toBe(2)
  })
})

describe('executePush identity safety', () => {
  test('clears currentPushPromise when it was set to the executing promise', async () => {
    immediatePush()
    mod = await freshMod()
    mod._resetWatcherStateForTesting({ syncState: { lastKnownChecksum: null, serverChecksums: new Map(), serverMaxEntries: null } })

    expect(mod._test.currentPushPromise).toBeNull()
    mod._test.currentPushPromise = mod._test.executePush()
    expect(mod._test.currentPushPromise).not.toBeNull()

    await mod._test.currentPushPromise

    expect(mod._test.pushInProgress).toBe(false)
    expect(mod._test.currentPushPromise).toBeNull()
  })

  test('preserves currentPushPromise when replaced during yield point', async () => {
    immediatePush()
    mod = await freshMod()
    mod._resetWatcherStateForTesting({ syncState: { lastKnownChecksum: null, serverChecksums: new Map(), serverMaxEntries: null } })

    const replacement: Promise<void> = Promise.resolve()

    const pushP = mod._test.executePush()
    mod._test.currentPushPromise = pushP
    mod._test.currentPushPromise = replacement

    await pushP

    expect(mod._test.pushInProgress).toBe(false)
    expect(mod._test.currentPushPromise).toBe(replacement)
  })
})
