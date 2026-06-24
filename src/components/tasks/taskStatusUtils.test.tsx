import { describe, expect, test } from 'bun:test'
import type { TaskState } from '../../tasks/types.js'
import {
  countVisibleBackgroundTasks,
  shouldHideTasksFooter,
} from './taskStatusUtils.js'

function task(
  status: string,
  isBackgrounded = true,
  type: TaskState['type'] = 'local_bash',
): TaskState {
  return {
    id: `${type}-${status}-${String(isBackgrounded)}`,
    type,
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

describe('shouldHideTasksFooter', () => {
  test('hides spinner-tree teammate-only background tasks', () => {
    const tasks = {
      teammateRunning: task('running', true, 'in_process_teammate'),
      teammatePending: task('pending', true, 'in_process_teammate'),
    }

    expect(shouldHideTasksFooter(tasks, true)).toBe(true)
  })

  test('shows spinner-tree footer when any non-teammate background task is visible', () => {
    const tasks = {
      teammate: task('running', true, 'in_process_teammate'),
      shell: task('pending'),
    }

    expect(shouldHideTasksFooter(tasks, true)).toBe(false)
  })

  test('does not hide footer when no background tasks are visible', () => {
    const tasks = {
      completed: task('completed'),
      foreground: task('running', false),
    }

    expect(shouldHideTasksFooter(tasks, true)).toBe(false)
  })
})
