// LocalWorkflowTask — task registry entry for the 'local_workflow' type
// (WORKFLOW_SCRIPTS-gated, internal-only).
//
// The closed-source implementation runs workflow scripts as background
// tasks that orchestrate multiple agents. This open-source build ships
// the state type plus inert task plumbing: the feature flag is disabled,
// so no workflow task is ever spawned; kill/skip/retry are honest no-ops
// against AppState.

import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { evictTaskOutput } from '../../utils/task/diskOutput.js'
import { updateTaskState } from '../../utils/task/framework.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  /** meta.name from the workflow script (e.g. 'spec'). */
  workflowName?: string
  /** One-line progress summary shown in task lists. */
  summary?: string
  /** Number of agents orchestrated by this workflow. */
  agentCount: number
}

export const LocalWorkflowTask: Task = {
  name: 'LocalWorkflowTask',
  type: 'local_workflow',
  async kill(taskId, setAppState) {
    updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
      if (task.status !== 'running') {
        return task
      }

      return {
        ...task,
        status: 'killed',
        notified: true,
        endTime: Date.now(),
      }
    })
    void evictTaskOutput(taskId)
  },
}

/** Stop a running workflow task. */
export function killWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  void LocalWorkflowTask.kill(taskId, setAppState)
}

/**
 * Skip the named agent in a running workflow.
 * No-op in this build (no workflow engine).
 */
export function skipWorkflowAgent(
  _taskId: string,
  _agentId: string,
  _setAppState: SetAppState,
): void {}

/**
 * Retry the named agent in a running workflow.
 * No-op in this build (no workflow engine).
 */
export function retryWorkflowAgent(
  _taskId: string,
  _agentId: string,
  _setAppState: SetAppState,
): void {}
