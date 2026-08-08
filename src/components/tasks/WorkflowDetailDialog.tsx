/**
 * Detail view for a local workflow task (WORKFLOW_SCRIPTS-gated).
 *
 * The closed-source implementation shows per-agent workflow progress with
 * skip/retry controls. This open-source build ships a null-rendering
 * component: the feature flag is disabled, so BackgroundTasksDialog never
 * reaches this branch.
 */

import * as React from 'react'
import type { LocalWorkflowTaskState } from 'src/tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type { DeepImmutable } from 'src/types/utils.js'
import type { CommandResultDisplay } from '../../commands.js'

type Props = {
  workflow: DeepImmutable<LocalWorkflowTaskState>
  onDone: (
    result?: string,
    options?: {
      display?: CommandResultDisplay
    },
  ) => void
  onKill?: () => void
  onSkipAgent?: (agentId: string) => void
  onRetryAgent?: (agentId: string) => void
  onBack?: () => void
}

export function WorkflowDetailDialog(_props: Props): React.ReactNode {
  return null
}
