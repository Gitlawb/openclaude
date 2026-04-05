import type { Tier, ClassifierResult, ProviderOverride, HealthStatus, RouterConfig, TierConfig } from './types.js'
import { DEFAULT_TIER_CONFIGS, TIER_ORDER } from './types.js'
import { classifyTask } from './classifier.js'
import { applySpeedGate } from './speedGate.js'
import type { EventLog } from './eventLog.js'

export class TieredRouter {
  private config: RouterConfig
  private healthStatuses: Map<Tier, HealthStatus> = new Map()
  private eventLog: EventLog | null = null
  private regressionData: Map<string, number> = new Map()
  private enabled: boolean = true
  private errorCount: number = 0
  private readonly MAX_ERRORS = 5
  private tierOverride: Tier | null = null
  private tierLock: Tier | null = null

  constructor(config?: Partial<RouterConfig>) {
    this.config = {
      tiers: config?.tiers ?? DEFAULT_TIER_CONFIGS,
      escalationRules: config?.escalationRules ?? [],
      budgetDaily: config?.budgetDaily ?? 5,
      budgetMonthly: config?.budgetMonthly ?? 50,
      healthCheckIntervalMs: config?.healthCheckIntervalMs ?? 60000,
      speedGateThresholdMs: config?.speedGateThresholdMs ?? 3000,
      diffGateThreshold: config?.diffGateThreshold ?? 500,
      contextWarnings: config?.contextWarnings ?? { yellow: 0.6, orange: 0.8, red: 0.9 },
    }
  }

  setEventLog(eventLog: EventLog): void { this.eventLog = eventLog }
  updateHealth(tier: Tier, status: HealthStatus): void { this.healthStatuses.set(tier, status) }
  updateRegressionData(data: Map<string, number>): void { this.regressionData = data }
  setTierOverride(tier: Tier | null): void { this.tierOverride = tier }
  setTierLock(tier: Tier | null): void { this.tierLock = tier }
  isEnabled(): boolean { return this.enabled }

  routeTask(
    prompt: string,
    options: { agentName?: string; subagentType?: string; contextTokens?: number; targetFiles?: string[] } = {},
  ): { override: ProviderOverride | null; classification: ClassifierResult; tier: Tier } {
    if (!this.enabled) return this.fallbackRoute()

    try {
      if (this.tierLock) {
        return this.buildRoute(this.tierLock, this.makeClassification(this.tierLock, 'tier_locked'))
      }
      if (this.tierOverride) {
        const route = this.buildRoute(this.tierOverride, this.makeClassification(this.tierOverride, 'user_override'))
        this.tierOverride = null
        return route
      }

      const classification = classifyTask(prompt, {
        agentName: options.agentName,
        subagentType: options.subagentType,
        contextTokens: options.contextTokens,
        escalationRules: this.config.escalationRules.length > 0 ? this.config.escalationRules : undefined,
      })

      let tier = classification.finalTier

      const speedResult = applySpeedGate(tier, this.healthStatuses, this.config.speedGateThresholdMs)
      if (speedResult.finalTier !== tier) {
        classification.escalations.push(`speed_gate: ${speedResult.reason}`)
        tier = speedResult.finalTier
      }

      if (options.targetFiles) {
        for (const file of options.targetFiles) {
          const failCount = this.regressionData.get(file) ?? 0
          if (failCount >= 3) {
            const tierRank: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 }
            const nextUp = TIER_ORDER[Math.min(tierRank[tier] + 1, 4)]!
            if (tierRank[nextUp] > tierRank[tier]) {
              classification.escalations.push(`regression: ${file} failed ${failCount} times`)
              tier = nextUp
            }
          }
        }
      }

      classification.finalTier = tier

      this.eventLog?.emit({
        event: 'route',
        tier,
        initial_tier: classification.initialTier,
        reason: classification.reason,
        escalations: classification.escalations,
        doc_needed: classification.docNeeded,
        estimated_tokens: classification.estimatedTokens,
      })

      return this.buildRoute(tier, classification)
    } catch (err) {
      this.errorCount++
      this.eventLog?.emit({ event: 'router_error', error: String(err), error_count: this.errorCount })
      if (this.errorCount >= this.MAX_ERRORS) {
        this.enabled = false
        this.eventLog?.emit({ event: 'router_disabled', reason: `${this.MAX_ERRORS} errors reached` })
      }
      return this.fallbackRoute()
    }
  }

  private buildRoute(tier: Tier, classification: ClassifierResult): { override: ProviderOverride | null; classification: ClassifierResult; tier: Tier } {
    const tierConfig = this.config.tiers[tier]
    if (!tierConfig) return this.fallbackRoute()

    const apiKey = process.env[tierConfig.apiKeyEnv]
    if (!apiKey) {
      const tierRank: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 }
      for (let i = tierRank[tier] + 1; i < TIER_ORDER.length; i++) {
        const nextConfig = this.config.tiers[TIER_ORDER[i]!]
        const nextKey = nextConfig ? process.env[nextConfig.apiKeyEnv] : undefined
        if (nextKey && nextConfig) {
          return { override: { model: nextConfig.model, baseURL: nextConfig.baseURL, apiKey: nextKey }, classification, tier: TIER_ORDER[i]! }
        }
      }
      return this.fallbackRoute()
    }

    if (tier === 'T3' || tier === 'T4') {
      return { override: null, classification, tier }
    }

    return { override: { model: tierConfig.model, baseURL: tierConfig.baseURL, apiKey }, classification, tier }
  }

  private fallbackRoute(): { override: ProviderOverride | null; classification: ClassifierResult; tier: Tier } {
    return { override: null, classification: this.makeClassification('T1', 'fallback'), tier: 'T1' }
  }

  private makeClassification(tier: Tier, reason: string): ClassifierResult {
    return { initialTier: tier, finalTier: tier, reason, docNeeded: false, estimatedTokens: 0, escalations: [] }
  }
}
