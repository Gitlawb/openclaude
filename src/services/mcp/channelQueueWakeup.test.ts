/**
 * Tests for the headless queue wakeup path — when a channel notification
 * arrives, it's enqueued via enqueue() which triggers subscribeToCommandQueue
 * callbacks. In headless mode (print.ts), the callback calls run() if idle.
 *
 * We test the pattern directly (signal → subscriber → run) rather than
 * importing the real messageQueueManager which has deep dependencies that
 * conflict with module mocks from adjacent test files.
 */
import { describe, expect, test, mock } from 'bun:test'

/**
 * Minimal reproduction of the signal + queue pattern from
 * messageQueueManager.ts + print.ts. The real implementation calls
 * createSignal() for subscribeToCommandQueue. We replicate the exact
 * interface to validate the wakeup contract.
 */
function createTestQueue() {
  const commands: Array<{ value: string; priority: string }> = []
  const listeners = new Set<() => void>()

  function subscribe(cb: () => void) {
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  }

  function notify() {
    for (const cb of listeners) cb()
  }

  function enqueue(cmd: { value: string; priority: string }) {
    commands.push(cmd)
    notify()
  }

  function hasCommands() {
    return commands.length > 0
  }

  function getAll() {
    return [...commands]
  }

  function dequeue() {
    return commands.shift()
  }

  return { subscribe, enqueue, hasCommands, getAll, dequeue }
}

describe('headless queue wakeup path', () => {
  test('enqueue triggers subscriber callback', () => {
    const q = createTestQueue()
    const callback = mock(() => {})
    const unsub = q.subscribe(callback)

    q.enqueue({ value: 'hello from telegram', priority: 'next' })
    expect(callback).toHaveBeenCalledTimes(1)

    unsub()
  })

  test('hasCommands returns true after enqueue', () => {
    const q = createTestQueue()
    expect(q.hasCommands()).toBe(false)
    q.enqueue({ value: 'test message', priority: 'next' })
    expect(q.hasCommands()).toBe(true)
  })

  test('channel messages enqueued at priority next are visible', () => {
    const q = createTestQueue()
    q.enqueue({ value: 'channel msg', priority: 'next' })
    const all = q.getAll()
    expect(all).toHaveLength(1)
    expect(all[0]!.priority).toBe('next')
    expect(all[0]!.value).toBe('channel msg')
  })

  test('subscriber fires for each enqueue (multiple channel messages)', () => {
    const q = createTestQueue()
    const callback = mock(() => {})
    const unsub = q.subscribe(callback)

    q.enqueue({ value: 'msg 1', priority: 'next' })
    q.enqueue({ value: 'msg 2', priority: 'next' })
    q.enqueue({ value: 'msg 3', priority: 'next' })

    expect(callback).toHaveBeenCalledTimes(3)
    expect(q.hasCommands()).toBe(true)

    unsub()
  })

  test('simulated headless wakeup: idle → run on first message, skip while running', () => {
    const q = createTestQueue()
    // Simulate the headless mode pattern from print.ts:
    //   subscribeToCommandQueue(() => {
    //     if (!running && hasCommandsInQueue()) { void run() }
    //   })
    let running = false
    let runCalled = 0
    const fakeRun = () => {
      if (running) return
      running = true
      runCalled++
    }

    const unsub = q.subscribe(() => {
      if (!running && q.hasCommands()) {
        fakeRun()
      }
    })

    // idle → message arrives → should trigger run
    q.enqueue({ value: 'wake up!', priority: 'next' })
    expect(runCalled).toBe(1)
    expect(running).toBe(true)

    // already running → second message → should NOT trigger run again
    q.enqueue({ value: 'another msg', priority: 'next' })
    expect(runCalled).toBe(1) // still 1

    unsub()
  })

  test('unsubscribed listener does not fire', () => {
    const q = createTestQueue()
    const callback = mock(() => {})
    const unsub = q.subscribe(callback)
    unsub()

    q.enqueue({ value: 'after unsub', priority: 'next' })
    expect(callback).not.toHaveBeenCalled()
  })

  test('multiple subscribers each get notified', () => {
    const q = createTestQueue()
    const cb1 = mock(() => {})
    const cb2 = mock(() => {})
    const unsub1 = q.subscribe(cb1)
    const unsub2 = q.subscribe(cb2)

    q.enqueue({ value: 'broadcast', priority: 'next' })
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)

    unsub1()
    unsub2()
  })
})
