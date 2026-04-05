import type { LocalCommandCall } from '../../types/command.js'
import { DecisionLog } from '../../services/router/decisionLog.js'
import { getEventLog } from '../../services/router/index.js'

export const call: LocalCommandCall = async (args: string) => {
  const cwd = process.cwd()
  const log = new DecisionLog(cwd)
  const eventLog = getEventLog()
  const parts = args.trim().split(/\s+/)
  const sub = parts[0]?.toLowerCase()

  if (sub === 'add' && parts.length > 1) {
    const title = parts.slice(1).join(' ')
    const d = log.addDecision({
      title,
      choice: title,
      why: 'Manually logged',
      alternativesRejected: [],
      session: eventLog?.getSessionId() ?? 'unknown',
    })
    return { type: 'text', value: 'Decision logged: **' + d.title + '** (' + d.id + ')' }
  }

  if (sub === 'remove' && parts[1]) {
    const removed = log.removeDecision(parts[1])
    return { type: 'text', value: removed ? 'Decision ' + parts[1] + ' removed.' : 'Decision ' + parts[1] + ' not found.' }
  }

  if (sub === 'search' && parts.length > 1) {
    const query = parts.slice(1).join(' ')
    const results = log.searchDecisions(query)
    if (results.length === 0) return { type: 'text', value: 'No decisions matching "' + query + '".' }
    const lines = results.map(d => '- **' + d.title + '**: ' + d.choice + ' -- ' + d.why + ' (' + d.id + ')')
    return { type: 'text', value: lines.join('\n') }
  }

  const all = log.getDecisions()
  if (all.length === 0) return { type: 'text', value: 'No decisions recorded. Use /decisions add <title> to log one.' }

  const lines = ['## Project Decisions', '']
  for (const d of all) {
    lines.push('### ' + d.date + ' -- ' + d.title)
    lines.push('**Choice:** ' + d.choice)
    lines.push('**Why:** ' + d.why)
    if (d.alternativesRejected.length > 0) lines.push('**Rejected:** ' + d.alternativesRejected.join(', '))
    lines.push('ID: ' + d.id, '')
  }
  return { type: 'text', value: lines.join('\n') }
}