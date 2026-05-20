import React from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js';
import { Dialog } from '../design-system/Dialog.js';
import { Text } from '../../ink.js';

type Props = {
  workflow: LocalWorkflowTaskState;
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  onKill?: () => void;
  onSkipAgent?: (agentId: string) => void;
  onRetryAgent?: (agentId: string) => void;
  onBack?: () => void;
};

export function WorkflowDetailDialog({
  workflow,
  onDone
}: Props): React.ReactNode {
  return <Dialog title="Workflow details" onCancel={() => onDone("Workflow details dismissed", {
    display: "system"
  })}>
      <Text>{workflow.workflowName ?? workflow.summary ?? workflow.description ?? workflow.id}</Text>
    </Dialog>;
}
