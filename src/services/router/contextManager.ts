import type { Tier, TierConfig } from './types.js'
import { DEFAULT_TIER_CONFIGS } from './types.js'
import type { EventLog } from './eventLog.js'

export type ContextLevel = 'ok' | 'yellow' | 'orange' | 'red'

export interface ContextStatus {
  currentTokens: number
  maxTokens: number
  workBudget: number
  usagePercent: number
  level: ContextLevel
  tier: Tier
}

export class ContextManager {
  private currentTokens: number = 0
  private activeTier: Tier = 'T1'
  private tiers: Record<Tier, TierConfig>
  private eventLog: EventLog | null = null
  private thresholds: { yellow: number; orange: number; red: number }
  private lastWarningLevel: ContextLevel = 'ok'
  private taskStartTokens: number = 0
  private reservePercent: number = 0.1

  constructor(
    tiers: Record<Tier, TierConfig> = DEFAULT_TIER_CONFIGS,
    thresholds: { yellow: number; orange: number; red: number } = { yellow: 0.6, orange: 0.8, red: 0.9 },
  ) {
    this.tiers = tiers
    this.thresholds = thresholds
  }

  setEventLog(eventLog: EventLog): void { this.eventLog = eventLog }

  setActiveTier(tier: Tier): void { this.activeTier = tier }

  addTokens(count: number): ContextStatus {
    this.currentTokens += count
    const status = this.getStatus()
    this.checkThresholds(status)
    return status
  }

  getStatus(): ContextStatus {
    const config = this.tiers[this.activeTier]
    const maxTokens = config?.maxContext ?? 128000
    const workBudget = config?.workBudget ?? 80000
    const usagePercent = workBudget > 0 ? this.currentTokens / workBudget : 0
    let level: ContextLevel = 'ok'
    if (usagePercent >= this.thresholds.red) level = 'red'
    else if (usagePercent >= this.thresholds.orange) level = 'orange'
    else if (usagePercent >= this.thresholds.yellow) level = 'yellow'
    return { currentTokens: this.currentTokens, maxTokens, workBudget, usagePercent, level, tier: this.activeTier }
  }

  getRemainingBudget(): number {
    const config = this.tiers[this.activeTier]
    const workBudget = config?.workBudget ?? 80000
    const reserved = workBudget * this.reservePercent
    return Math.max(0, workBudget - this.currentTokens - reserved)
  }

  canFitTask(estimatedTokens: number): boolean {
    return estimatedTokens <= this.getRemainingBudget()
  }

  startTask(): void {
    this.taskStartTokens = this.currentTokens
  }

  getTaskTokens(): number {
    return this.currentTokens - this.taskStartTokens
  }

  reset(): void {
    this.currentTokens = 0
    this.lastWarningLevel = 'ok'
    this.taskStartTokens = 0
  }

  formatStatusLine(): string {
    const status = this.getStatus()
    const used = (status.currentTokens / 1000).toFixed(0)
    const budget = (status.workBudget / 1000).toFixed(0)
    const pct = (status.usagePercent * 100).toFixed(0)
    const icon = status.level === 'ok' ? '' : status.level === 'yellow' ? ' !' : status.level === 'orange' ? ' !!' : ' !!!'
    return `[CTX: ${used}K/${budget}K ${pct}%${icon}]`
  }

  private checkThresholds(status: ContextStatus): void {
    if (status.level !== this.lastWarningLevel && status.level !== 'ok') {
      this.lastWarningLevel = status.level
      this.eventLog?.emit({
        event: 'context_warning',
        level: status.level,
        usage_percent: status.usagePercent,
        current_tokens: status.currentTokens,
        work_budget: status.workBudget,
        tier: status.tier,
      })
    }
  }
}
