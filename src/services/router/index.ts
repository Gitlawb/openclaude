import { TieredRouter } from './tieredRouter.js'
import { EventLog } from './eventLog.js'
import { PriceTable } from './priceTable.js'
import { CostTracker } from './costTracker.js'
import { HealthMonitor } from './healthMonitor.js'
import { RegressionWatch } from './regressionWatch.js'
import type { Tier, ProviderOverride, ClassifierResult } from './types.js'

export { TieredRouter } from './tieredRouter.js'
export { EventLog } from './eventLog.js'
export { PriceTable } from './priceTable.js'
export { CostTracker } from './costTracker.js'
export { HealthMonitor } from './healthMonitor.js'
export { RegressionWatch } from './regressionWatch.js'
export { classifyTask } from './classifier.js'
export { checkEscalation } from './escalationRules.js'
export { applySpeedGate } from './speedGate.js'
export { scanForSecrets, hasSensitiveContent } from './secretScanner.js'
export { classifyCommand } from './destructiveGuard.js'
export type { Tier, ProviderOverride, ClassifierResult, RouterConfig, HealthStatus, CostEntry } from './types.js'

export { DocCache } from './docCache.js'
export { DocEngine } from './docEngine.js'
export { ContextManager } from './contextManager.js'
export { compressContext } from './contextCompressor.js'
export { Checkpointer } from './checkpointer.js'
export { DriftDetector } from './driftDetector.js'

let router: TieredRouter | null = null
let eventLog: EventLog | null = null
let costTracker: CostTracker | null = null
let healthMonitor: HealthMonitor | null = null
let regressionWatch: RegressionWatch | null = null

export function initRouter(projectDir: string): {
  router: TieredRouter; eventLog: EventLog; costTracker: CostTracker; healthMonitor: HealthMonitor; regressionWatch: RegressionWatch
} {
  const priceTable = new PriceTable()
  eventLog = new EventLog(projectDir)
  costTracker = new CostTracker(projectDir, priceTable)
  healthMonitor = new HealthMonitor(projectDir)
  regressionWatch = new RegressionWatch(projectDir)
  router = new TieredRouter()

  router.setEventLog(eventLog)
  costTracker.setEventLog(eventLog)
  healthMonitor.setEventLog(eventLog)
  healthMonitor.start(60000)

  const updateRouterHealth = () => {
    for (const [tier, status] of healthMonitor!.getAllStatuses()) { router!.updateHealth(tier, status) }
    router!.updateRegressionData(new Map([...regressionWatch!.getAllRecords()].map(([k, v]) => [k, v.failCount])))
  }
  setTimeout(updateRouterHealth, 2000)

  eventLog.emit({ event: 'router_init', version: '1.0.0', project: projectDir })
  return { router, eventLog, costTracker, healthMonitor, regressionWatch }
}

export function getRouter(): TieredRouter | null { return router }
export function getEventLog(): EventLog | null { return eventLog }
export function getCostTracker(): CostTracker | null { return costTracker }
export function getHealthMonitor(): HealthMonitor | null { return healthMonitor }

export function shutdownRouter(): void {
  healthMonitor?.stop()
  eventLog?.end()
  router = null; eventLog = null; costTracker = null; healthMonitor = null; regressionWatch = null
}
