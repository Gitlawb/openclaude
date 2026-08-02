import { afterEach, describe, expect, test } from 'bun:test'

import type { QueryParams } from '../query.js'
import type { Terminal } from '../query/transitions.js'
import { getDefaultAppState, type AppState } from '../state/AppStateStore.js'
import type { Message } from '../types/message.js'
import { createAttachmentMessage } from '../utils/attachments.js'
import { dequeueAll } from '../utils/messageQueueManager.js'
import {
  isMainSessionTask,
  startBackgroundSession,
} from './LocalMainSessionTask.js'

async function waitFor(
  condition: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`)
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

afterEach(() => {
  dequeueAll()
})

describe('LocalMainSessionTask', () => {
  test('retains a max-turn terminal attachment in task messages', async () => {
    let state = getDefaultAppState()
    const setAppState = (update: (previous: AppState) => AppState): void => {
      state = update(state)
    }
    const cap = createAttachmentMessage({
      type: 'max_turns_reached',
      maxTurns: 1,
      turnCount: 2,
    })
    const queryImpl = async function* (): AsyncGenerator<Message, Terminal> {
      yield cap
      return { reason: 'max_turns', turnCount: 2 }
    }

    const taskId = startBackgroundSession({
      description: 'cap retention test',
      setAppState,
      queryImpl: queryImpl as typeof import('../query.js').query,
      prepare: async () => ({
        messages: [],
        queryParams: {} as Omit<QueryParams, 'messages'>,
      }),
    })

    await waitFor(
      () => state.tasks[taskId]?.status === 'completed',
      'background task completion',
    )

    const task = state.tasks[taskId]
    expect(isMainSessionTask(task)).toBe(true)
    if (!isMainSessionTask(task)) throw new Error('expected main-session task')
    expect(task.messages).toEqual([cap])
  })
})
