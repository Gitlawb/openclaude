import { expect, test } from 'bun:test'
import type { AppState } from '../state/AppState.js'
import type { Task } from '../Task.js'
import { cancelSessionTasks, hasActiveSessionTasks } from './cancelSessionTasks.js'

function fixture() {
  const first = new AbortController()
  const second = new AbortController()
  let state = { tasks: {
    first: { id: 'first', type: 'local_agent', status: 'running', abortController: first },
    second: { id: 'second', type: 'local_bash', status: 'running', abortController: second },
    pending: { id: 'pending', type: 'local_agent', status: 'pending' },
    done: { id: 'done', type: 'local_agent', status: 'completed' },
  } } as unknown as AppState
  const setState = (updater: (prev: AppState) => AppState) => { state = updater(state) }
  return { first, second, getState: () => state, setState }
}

test('stops all active tasks, including older background work and pending tasks, once', async () => {
  const f = fixture()
  const stopped: string[] = []
  const resolveTask = (type: Task['type']): Task => ({ name: type, type,
    async kill(id, setState) {
      stopped.push(id)
      setState(prev => ({ ...prev, tasks: { ...prev.tasks,
        [id]: { ...prev.tasks[id]!, status: 'killed' } } }))
    },
  })
  const stopping = cancelSessionTasks(f.getState, f.setState, resolveTask)
  expect(stopped).toEqual(['first', 'second', 'pending'])
  expect(f.first.signal.reason).toBe('user-cancel')
  expect(f.second.signal.aborted).toBe(true)
  await stopping
  expect(hasActiveSessionTasks(f.getState().tasks)).toBe(false)
  await cancelSessionTasks(f.getState, f.setState, resolveTask)
  expect(stopped).toHaveLength(3)
  expect(f.getState().tasks.done?.status).toBe('completed')
})

test('a failed stop cannot prevent other tasks from receiving cancellation', async () => {
  const f = fixture()
  const stopped: string[] = []
  const failed = await cancelSessionTasks(f.getState, f.setState, type => ({ name: type, type,
    async kill(id) {
      stopped.push(id)
      if (id === 'first') throw new Error('stop failed in fixture')
    },
  }))
  expect(failed).toEqual(['first'])
  expect(stopped).toEqual(['first', 'second', 'pending'])
  expect(f.second.signal.aborted).toBe(true)
  expect(f.getState().tasks.pending?.status).toBe('killed')
})
