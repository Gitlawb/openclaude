import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { Pane } from '../../components/design-system/Pane.js'
import { SteeringQuestionsOverlay } from '../../components/SteeringQuestionsOverlay.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

type Props = {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay; shouldQuery?: boolean },
  ) => void
}

function SteerCommand({ onDone }: Props): React.ReactNode {
  return (
    <Pane color="permission">
      <SteeringQuestionsOverlay
        onSubmit={(formatted: string) => {
          onDone(formatted, { display: 'user', shouldQuery: true })
        }}
        onCancel={() => {
          onDone('Steering questions dismissed', { display: 'system' })
        }}
      />
    </Pane>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context) => {
  return <SteerCommand onDone={onDone} />
}
