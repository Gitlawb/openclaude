import type { LocalCommandCall } from '../../types/command.js'
import { getRouter, getEventLog, getCostTracker, getHealthMonitor } from '../../services/router/index.js'
import { RegressionWatch } from '../../services/router/regressionWatch.js'
import { DecisionLog } from '../../services/router/decisionLog.js'
import { TaskPersistence } from '../../services/router/taskPersistence.js'

export const call: LocalCommandCall = async () => {
  const cwd = process.cwd()
  const router = getRouter()
  const eventLog = getEventLog()
  const costTracker = getCostTracker()
  const healthMonitor = getHealthMonitor()

  const lines = ['## Foundation Router Diagnostic', '']

  // Router
  lines.push('### Router')
  lines.push('- **Status:** ' + (router ? (router.isEnabled() ? 'active' : 'disabled') : 'not initialized'))
  lines.push('- **Session:** ' + (eventLog ? eventLog.getSessionId() : 'none'))
  lines.push('')

  // Health
  lines.push('### Provider Health')
  if (healthMonitor) {
    lines.push(healthMonitor.formatStatusBanner())
  } else {
    lines.push('Health monitor not initialized')
  }
  lines.push('')

  // Costs
  lines.push('### Costs')
  if (costTracker) {
    var today = costTracker.getTodaySummary()
    var savings = costTracker.getSavingsToday()
    lines.push('- **Today:** $' + today.total.toFixed(4))
    lines.push('- **Opus equivalent:** $' + today.opusEquivalent.toFixed(4))
    lines.push('- **Savings:** ' + savings.percentage.toFixed(1) + '%')
    lines.push('- **API calls today:** ' + Object.values(today.byModel).reduce(function(s, m) { return s + m.calls }, 0))
  } else {
    lines.push('Cost tracker not initialized')
  }
  lines.push('')

  // Regression Watch
  lines.push('### Regression Watch')
  try {
    var rw = new RegressionWatch(cwd)
    var problematic = rw.getProblematicFiles()
    if (problematic.size > 0) {
      for (var entry of problematic) {
        lines.push('- **' + entry[0] + '**: ' + entry[1].failCount + ' failures (last: ' + entry[1].lastFail + ')')
      }
    } else {
      lines.push('No problematic files')
    }
  } catch (e) {
    lines.push('Unable to read regression data')
  }
  lines.push('')

  // Decisions
  lines.push('### Decisions')
  try {
    var dl = new DecisionLog(cwd)
    var decisions = dl.getDecisions()
    lines.push(decisions.length + ' decisions recorded')
  } catch (e) {
    lines.push('Unable to read decisions')
  }
  lines.push('')

  // Tasks
  lines.push('### Tasks')
  try {
    var tp = new TaskPersistence(cwd)
    var pending = tp.getPendingTasks()
    var completed = tp.getCompletedTasks()
    lines.push('- **Pending:** ' + pending.length)
    lines.push('- **Completed:** ' + completed.length)
    lines.push('- **Total cost:** $' + tp.getTotalCost().toFixed(4))
  } catch (e) {
    lines.push('Unable to read tasks')
  }
  lines.push('')

  // Event Log
  lines.push('### Event Log')
  if (eventLog) {
    var recent = eventLog.getRecentEvents(5)
    lines.push('- **Disk:** ' + (eventLog.isDiskAvailable() ? 'available' : 'UNAVAILABLE'))
    lines.push('- **Log file:** ' + eventLog.getLogPath())
    lines.push('- **Recent events:** ' + recent.length)
  } else {
    lines.push('Event log not initialized')
  }

  return { type: 'text', value: lines.join('\n') }
}
