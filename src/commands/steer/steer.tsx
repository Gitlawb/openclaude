import * as React from 'react'
import { Pane } from '../../components/design-system/Pane.js'
import { SteeringQuestionsOverlay } from '../../components/SteeringQuestionsOverlay.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandOnDone,
} from '../../types/command.js'

type Props = {
  onDone: LocalJSXCommandOnDone
}

function SteerCommand({ onDone }: Props): React.ReactNode {
  return (
    <Pane color="permission">
      <SteeringQuestionsOverlay
        onSubmit={(formatted: string) => {
          // The formatted answers become the next prompt rather than a
          // quoted transcript entry: display 'skip' adds no messages, and
          // nextInput+submitNextInput queues the text as a real submission.
          onDone('', {
            display: 'skip',
            nextInput: formatted,
            submitNextInput: true,
          })
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
