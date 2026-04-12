// MonitorMcpTask — lifecycle management for 'monitor_mcp' tasks.
// MonitorTool spawns tasks via LocalShellTask (type: 'local_bash', kind: 'monitor').
// This module registers the 'monitor_mcp' task type in the task registry and
// provides killMonitorMcpTasksForAgent for agent-scoped cleanup.

import type { AppState } from '../../state/AppState.js'
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import type { AgentId } from '../../types/ids.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { dequeueAllMatching } from '../../utils/messageQueueManager.js'
import { evictTaskOutput } from '../../utils/task/diskOutput.js'
import { updateTaskState } from '../../utils/task/framework.js'
import { isLocalShellTask } from '../LocalShellTask/guards.js'
import { killTask } from '../LocalShellTask/killShellTasks.js'

export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  agentId?: AgentId
}

function isMonitorMcpTask(task: unknown): task is MonitorMcpTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'monitor_mcp'
  )
}

export const MonitorMcpTask: Task = {
  name: 'MonitorMcpTask',
  type: 'monitor_mcp',
  async kill(taskId, setAppState) {
    updateTaskState<MonitorMcpTaskState>(taskId, setAppState, task => {
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

/**
 * Kill all monitor tasks owned by a given agent.
 *
 * MonitorTool spawns tasks as local_bash with kind='monitor'. When an agent
 * exits, killShellTasksForAgent already handles those. This function provides
 * additional cleanup for any monitor_mcp-typed tasks and also kills any
 * local_bash tasks with kind='monitor' that might have been missed (belt and
 * suspenders). Finally, it purges queued notifications for the dead agent.
 */
export function killMonitorMcpTasksForAgent(
  agentId: AgentId,
  getAppState: () => AppState,
  setAppState: SetAppState,
): void {
  const tasks = getAppState().tasks ?? {}

  for (const [taskId, task] of Object.entries(tasks)) {
    // Kill monitor_mcp tasks for this agent
    if (
      isMonitorMcpTask(task) &&
      task.agentId === agentId &&
      task.status === 'running'
    ) {
      logForDebugging(
        `killMonitorMcpTasksForAgent: killing monitor_mcp task ${taskId} (agent ${agentId} exiting)`,
      )
      void MonitorMcpTask.kill(taskId, setAppState)
    }

    // Also kill local_bash tasks with kind='monitor' for this agent
    // (killShellTasksForAgent already does this, but being explicit
    // guards against ordering issues)
    if (
      isLocalShellTask(task) &&
      task.kind === 'monitor' &&
      task.agentId === agentId &&
      task.status === 'running'
    ) {
      logForDebugging(
        `killMonitorMcpTasksForAgent: killing monitor shell task ${taskId} (agent ${agentId} exiting)`,
      )
      killTask(taskId, setAppState)
    }
  }

  // Purge any queued notifications addressed to this agent — its query loop
  // has exited and won't drain them.
  dequeueAllMatching(cmd => cmd.agentId === agentId)
}
