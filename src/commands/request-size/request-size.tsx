import * as React from 'react'
import { Pane } from '../../components/design-system/Pane.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  createRequestSizeReport,
  formatRequestSizeReport,
} from '../../utils/requestSizeBreakdown.js'
import { collectContextData } from '../context/context-noninteractive.js'

type RequestSizeReportViewProps = {
  reportText: string
  onClose: () => void
}

export function RequestSizeReportView({
  reportText,
  onClose,
}: RequestSizeReportViewProps): React.ReactNode {
  useKeybinding('confirm:no', onClose, { context: 'Confirmation' })

  return (
    <Pane color="permission">
      <Box flexDirection="column">
        {reportText.split('\n').map((line, index) => (
          <Text key={index}>{line.length > 0 ? line : ' '}</Text>
        ))}
        <Box marginTop={1}>
          <Text dimColor>(press esc to close)</Text>
        </Box>
      </Box>
    </Pane>
  )
}

export const call: LocalJSXCommandCall = async (onDone, context) => {
  let reportText: string
  try {
    const data = await collectContextData(context)
    const report = createRequestSizeReport(data)
    reportText = formatRequestSizeReport(report)
  } catch {
    reportText = [
      'Request context size',
      '',
      'Unable to estimate request context size for the current context.',
    ].join('\n')
  }

  const close = () => {
    onDone(undefined, { display: 'skip' })
  }

  return <RequestSizeReportView reportText={reportText} onClose={close} />
}
