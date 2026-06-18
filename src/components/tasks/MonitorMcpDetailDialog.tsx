/**
 * Detail view for a monitor_mcp task (MONITOR_TOOL-gated).
 *
 * The closed-source implementation shows MCP monitor activity with a kill
 * control. This open-source build ships a null-rendering component: the
 * feature flag is disabled, so BackgroundTasksDialog never reaches this
 * branch.
 */

import * as React from 'react'
import type { MonitorMcpTaskState } from 'src/tasks/MonitorMcpTask/MonitorMcpTask.js'
import type { DeepImmutable } from 'src/types/utils.js'

type Props = {
  task: DeepImmutable<MonitorMcpTaskState>
  onKill?: () => void
  onBack?: () => void
}

export function MonitorMcpDetailDialog(_props: Props): React.ReactNode {
  return null
}
