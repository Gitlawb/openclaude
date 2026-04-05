import type { Tier, HealthStatus } from './types.js'
import { nextTier } from './types.js'

export function applySpeedGate(
  tier: Tier,
  healthStatuses: Map<Tier, HealthStatus>,
  speedThresholdMs: number = 3000,
): { finalTier: Tier; skippedTiers: Tier[]; reason: string | null } {
  let currentTier = tier
  const skippedTiers: Tier[] = []
  let reason: string | null = null

  while (currentTier) {
    const health = healthStatuses.get(currentTier)
    if (!health) break

    if (health.status === 'offline') {
      skippedTiers.push(currentTier)
      reason = `${currentTier} offline`
      const next = nextTier(currentTier)
      if (!next) break
      currentTier = next
      continue
    }

    if (currentTier === 'T0' && health.latencyPer1kTokens > speedThresholdMs) {
      skippedTiers.push(currentTier)
      reason = `${currentTier} too slow (${health.latencyPer1kTokens}ms/1K > ${speedThresholdMs}ms threshold)`
      const next = nextTier(currentTier)
      if (!next) break
      currentTier = next
      continue
    }

    if (currentTier === 'T0' && health.coldStart) {
      skippedTiers.push(currentTier)
      reason = `${currentTier} cold start (model not loaded)`
      const next = nextTier(currentTier)
      if (!next) break
      currentTier = next
      continue
    }

    break
  }

  return { finalTier: currentTier, skippedTiers, reason }
}
