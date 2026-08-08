import * as React from 'react'

import type { Tools } from '../../Tool.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import { Dialog } from '../design-system/Dialog.js'
import { AgentDetail } from './AgentDetail.js'

type Props = {
  agent: AgentDefinition
  tools: Tools
  allAgents?: AgentDefinition[]
  onBack: () => void
  title: React.ReactNode
  onCancel: () => void
  hideInputGuide?: boolean
}

// Wraps AgentDetail in its Dialog while mirroring the detail view's route-picker
// state up to the Dialog. While the picker is open its Select owns Esc (via
// select:cancel -> onClose). Without deactivating the Dialog's own confirm:no,
// the Dialog is the first-registered Confirmation context, so a bare Esc would
// fire its onCancel and leave the detail view instead of just closing the picker.
export function AgentDetailDialog({
  agent,
  tools,
  allAgents,
  onBack,
  title,
  onCancel,
  hideInputGuide,
}: Props): React.ReactNode {
  const [routing, setRouting] = React.useState(false)
  return (
    <Dialog
      title={title}
      onCancel={onCancel}
      hideInputGuide={hideInputGuide}
      isCancelActive={!routing}
    >
      <AgentDetail
        agent={agent}
        tools={tools}
        allAgents={allAgents}
        onBack={onBack}
        onRoutingChange={setRouting}
      />
    </Dialog>
  )
}
