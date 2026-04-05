import type { LocalCommandCall } from '../../types/command.js'
import { getEventLog } from '../../services/router/index.js'

export const call: LocalCommandCall = async (args: string) => {
  const eventLog = getEventLog()
  if (!eventLog) {
    return { type: 'text', value: 'Router not initialized. Event log unavailable.' }
  }

  const sub = args.trim().toLowerCase()
  const sessionId = eventLog.getSessionId()

  if (sub === 'decisions') {
    const events = eventLog.getEventsByType('decision', 50)
    if (events.length === 0) return { type: 'text', value: 'No decisions logged this session.' }
    const lines = ['## Decisions (Session ' + sessionId + ')', '']
    for (const e of events) {
      lines.push('- **' + (e.choice ?? 'decision') + '**: ' + (e.why ?? '') + ' (' + e.t + ')')
    }
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'costs') {
    const events = eventLog.getEventsByType('api_call', 50)
    if (events.length === 0) return { type: 'text', value: 'No API calls logged this session.' }
    let totalCost = 0
    const lines = ['## API Calls (Session ' + sessionId + ')', '', '| Time | Model | Tier | Tokens | Cost |', '|------|-------|------|--------|------|']
    for (const e of events) {
      const cost = Number(e.cost_total ?? 0)
      totalCost += cost
      const time = String(e.t ?? '').slice(11, 19)
      lines.push('| ' + time + ' | ' + e.model + ' | ' + e.tier + ' | ' + (Number(e.tokens_in ?? 0) + Number(e.tokens_out ?? 0)) + ' | $' + cost.toFixed(4) + ' |')
    }
    lines.push('', '**Total:** $' + totalCost.toFixed(4))
    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'all') {
    const events = eventLog.getRecentEvents(100)
    const lines = ['## Full Log (Session ' + sessionId + ', last 100 events)', '']
    for (const e of events) {
      const time = String(e.t ?? '').slice(11, 19)
      const filtered = Object.fromEntries(Object.entries(e).filter(([k]) => !['t', 'event', 'prev_hash'].includes(k)))
      lines.push(time + ' **' + e.event + '** ' + JSON.stringify(filtered))
    }
    return { type: 'text', value: lines.join('\n') }
  }

  const events = eventLog.getRecentEvents(20)
  const lines = ['## Recent Events (Session ' + sessionId + ')', '']
  for (const e of events) {
    const time = String(e.t ?? '').slice(11, 19)
    const extra = e.tier ? ' [' + e.tier + ']' : ''
    lines.push(time + ' ' + e.event + extra)
  }
  return { type: 'text', value: lines.join('\n') }
}