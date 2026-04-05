import type { Tier, EscalationRule } from './types.js'

export const DEFAULT_ESCALATION_RULES: EscalationRule[] = [
  {
    patterns: [/api.?key/i, /password/i, /credential/i, /secret/i, /\btoken\b/i, /\bPII\b/i, /client.*data/i, /private.*key/i],
    minTier: 'T3' as Tier,
    reason: 'sensitive_data',
  },
  {
    patterns: [/schema.*design/i, /migration/i, /breaking.?change/i, /\barchitecture\b/i, /system.*design/i],
    minTier: 'T4' as Tier,
    reason: 'architecture',
  },
  {
    patterns: [/vulnerabilit/i, /injection/i, /auth.*bypass/i, /\bCVE\b/i, /\bXSS\b/i, /\bSSRF\b/i, /security.*review/i],
    minTier: 'T4' as Tier,
    reason: 'security',
  },
]

export function checkEscalation(
  prompt: string,
  rules: EscalationRule[] = DEFAULT_ESCALATION_RULES,
): { escalated: boolean; minTier: Tier | null; reasons: string[] } {
  let highestTier: Tier | null = null
  const reasons: string[] = []
  const tierRank: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 }

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(prompt)) {
        if (!highestTier || tierRank[rule.minTier] > tierRank[highestTier]) {
          highestTier = rule.minTier
        }
        if (!reasons.includes(rule.reason)) {
          reasons.push(rule.reason)
        }
        break
      }
    }
  }

  return { escalated: highestTier !== null, minTier: highestTier, reasons }
}
