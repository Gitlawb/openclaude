import type { AppState } from '../state/AppState.js'
import type { SetAppState, Task, TaskStateBase } from '../Task.js'
import { getTaskByType } from '../tasks.js'
import { logError } from '../utils/log.js'
import { emitTaskTerminatedSdk } from '../utils/sdkEventQueue.js'
import { InProcessTeammateTask } from './InProcessTeammateTask/InProcessTeammateTask.js'

export function hasActiveSessionTasks(tasks: AppState['tasks']): boolean {
  return Object.values(tasks).some(t => t.status === 'running' || t.status === 'pending')
}

/** Issue every stop synchronously, then collect failures independently. */
export async function cancelSessionTasks(
  getAppState: () => AppState,
  setAppState: SetAppState,
  resolveTask: (type: TaskStateBase['type']) => Task | undefined = type =>
    type === 'in_process_teammate' ? InProcessTeammateTask : getTaskByType(type),
): Promise<string[]> {
  const tasks = Object.values(getAppState().tasks).filter(
    task => task.status === 'running' || task.status === 'pending',
  )
  if (tasks.length === 0) return []
  // Suppress per-task notifications before abort handlers start resolving.
  // The REPL records a single interruption; user messages stay in the queue.
  const ids = new Set(tasks.map(task => task.id))
  setAppState(prev => ({
    ...prev,
    tasks: Object.fromEntries(Object.entries(prev.tasks).map(([id, task]) =>
      [id, ids.has(id) ? { ...task, notified: true } : task],
    )),
  }))
  const results = await Promise.allSettled(tasks.map(async task => {
    const impl = resolveTask(task.type)
    if (!impl) throw new Error(`Cannot stop task type: ${task.type}`)
    if ('abortController' in task) task.abortController?.abort('user-cancel')
    const stopping = impl.kill(task.id, setAppState)
    setAppState(prev => {
      const current = prev.tasks[task.id]
      if (current?.status !== 'pending') return prev
      return { ...prev, tasks: { ...prev.tasks,
        [task.id]: { ...current, status: 'killed', notified: true, endTime: Date.now() } } }
    })
    await stopping
    // Remote tasks already emit their own SDK termination event.
    if (task.type !== 'remote_agent' && task.type !== 'in_process_teammate') {
      emitTaskTerminatedSdk(task.id, 'stopped', {
        toolUseId: task.toolUseId, summary: task.description,
      })
    }
  }))
  return results.flatMap((result, index) => {
    if (result.status !== 'rejected') return []
    logError(result.reason)
    return [tasks[index]!.id]
  })
}
