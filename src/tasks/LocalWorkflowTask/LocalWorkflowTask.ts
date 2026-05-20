import type { SetAppState, Task, TaskStateBase } from '../../Task.js';

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow';
  workflowName?: string;
  summary?: string;
  description?: string;
  agentCount: number;
  notified?: boolean;
};

export const LocalWorkflowTask: Task = {
  name: 'LocalWorkflowTask',
  type: 'local_workflow',
  async kill(_taskId, _setAppState) {}
};

export function killWorkflowTask(_taskId: string, _setAppState: SetAppState): void {}
export function skipWorkflowAgent(_taskId: string, _agentId: string, _setAppState: SetAppState): void {}
export function retryWorkflowAgent(_taskId: string, _agentId: string, _setAppState: SetAppState): void {}
