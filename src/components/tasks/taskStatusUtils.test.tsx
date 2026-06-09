import { describe, expect, test } from 'bun:test'
import type { TaskState } from '../../tasks/types.js'
import { countVisibleBackgroundTasks } from './taskStatusUtils.js'

function task(status: string, isBackgrounded = true): TaskState {
  return {
    id: `${status}-${String(isBackgrounded)}`,
    type: 'local_bash',
    status,
    isBackgrounded,
  } as unknown as TaskState
}

describe('countVisibleBackgroundTasks', () => {
  test('counts running and pending tasks that render in the background task pill', () => {
    const tasks = {
      running: task('running'),
      pending: task('pending'),
      completed: task('completed'),
      foreground: task('running', false),
    }

    expect(countVisibleBackgroundTasks(tasks)).toBe(2)
  })
})
