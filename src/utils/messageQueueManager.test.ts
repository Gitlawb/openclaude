import { afterEach, expect, test } from 'bun:test'
import {
  dequeue,
  dequeueAll,
  enqueue,
  getCommandQueue,
  prepend,
  resetCommandQueue,
  subscribeToCommandQueue,
} from './messageQueueManager.js'

afterEach(() => resetCommandQueue())

test('prepend restores commands ahead of later enqueues in FIFO order', () => {
  const notifications: number[] = []
  const unsubscribe = subscribeToCommandQueue(() => notifications.push(1))
  try {
    const restored = [
      { value: 'first restored', mode: 'prompt' as const, priority: 'later' as const },
      { value: 'second restored', mode: 'prompt' as const, priority: 'now' as const },
      { value: 'third restored', mode: 'prompt' as const, priority: 'now' as const },
    ]
    prepend(restored)
    expect(notifications).toHaveLength(1)
    enqueue({ value: 'later enqueue', mode: 'prompt' })

    expect(getCommandQueue()).toEqual([
      ...restored,
      { value: 'later enqueue', mode: 'prompt', priority: 'next' },
    ])
    expect(notifications).toHaveLength(2)
    expect(dequeue()).toMatchObject(restored[1]!)
    expect(dequeue()).toMatchObject(restored[2]!)
    expect(dequeueAll()).toEqual([
      restored[0],
      { value: 'later enqueue', mode: 'prompt', priority: 'next' },
    ])
  } finally {
    unsubscribe()
  }
})
