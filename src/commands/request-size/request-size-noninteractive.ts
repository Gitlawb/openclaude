import type { LocalCommandCall } from '../../types/command.js'
import {
  createRequestSizeReport,
  formatRequestSizeReport,
} from '../../utils/requestSizeBreakdown.js'
import { collectContextData } from '../context/context-noninteractive.js'

export const call: LocalCommandCall = async (_args, context) => {
  let value: string
  try {
    const data = await collectContextData(context)
    const report = createRequestSizeReport(data)
    value = formatRequestSizeReport(report)
  } catch {
    value = [
      'Request size',
      '',
      'Unable to estimate request size for the current context.',
    ].join('\n')
  }

  return {
    type: 'text',
    value,
    display: 'skip',
  }
}
