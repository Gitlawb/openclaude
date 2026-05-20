import React from 'react';
import type { MonitorMcpTaskState } from '../../tasks/MonitorMcpTask/MonitorMcpTask.js';
import { Dialog } from '../design-system/Dialog.js';
import { Text } from '../../ink.js';

type Props = {
  task: MonitorMcpTaskState;
  onKill?: () => void;
  onBack?: () => void;
};

export function MonitorMcpDetailDialog({
  task,
  onBack
}: Props): React.ReactNode {
  return <Dialog title="Monitor MCP details" onCancel={onBack}>
      <Text>{task.id}</Text>
    </Dialog>;
}
