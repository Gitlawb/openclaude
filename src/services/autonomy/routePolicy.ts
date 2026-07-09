import type { SettingsJson } from '../../utils/settings/types.js'
import type { TaskTier } from './complexityClassifier.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export type AutonomyMode = 'smart' | 'fast' | 'code' | 'quality' | 'fixed'

export type RouteDecision = {
  model: string
  baseURL: string
  apiKey: string
  effort?: 'low' | 'medium' | 'high' | 'max'
  tier: TaskTier
  reason: string[]
  fallbackChain: string[]
  source: 'static' | 'policy' | 'health-override' | 'fallback'
}

export type ResolveTaskRouteInput = {
  tier: TaskTier
  agentName?: string
  subagentType?: string
  settings: SettingsJson
  userPinnedModel?: string
  /** When set, skip env/settings mode resolution */
  modeOverride?: AutonomyMode
}

function normalize(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '')
}

export function resolveAutonomyMode(
  settings: SettingsJson | null | undefined,
  modeOverride?: AutonomyMode,
): AutonomyMode {
  if (modeOverride) return modeOverride
  const envMode = process.env.OPENCLAUDE_AUTONOMY_MODE?.toLowerCase()
  if (
    envMode === 'smart' ||
    envMode === 'fast' ||
    envMode === 'code' ||
    envMode === 'quality' ||
    envMode === 'fixed'
  ) {
    return envMode
  }
  return settings?.autonomy?.mode ?? 'smart'
}

export function isAutonomyEnabled(
  settings: SettingsJson | null | undefined,
): boolean {
  if (isEnvTruthy(process.env.OPENCLAUDE_AUTONOMY)) return true
  if (process.env.OPENCLAUDE_AUTONOMY === '0') return false
  return Boolean(settings?.autonomy?.enabled)
}

function lookupModelConfig(
  models: NonNullable<SettingsJson['agentModels']>,
  modelName: string,
): { base_url: string; api_key: string } | null {
  if (models[modelName]) return models[modelName]!
  // Case-insensitive fallback
  const target = normalize(modelName)
  for (const [key, value] of Object.entries(models)) {
    if (normalize(key) === target) return value
  }
  return null
}

function resolveLegacyAgentModel(
  settings: SettingsJson,
  agentName?: string,
  subagentType?: string,
): string | undefined {
  const routing = settings.agentRouting
  if (!routing) return undefined

  const normalizedRouting = new Map<string, string>()
  for (const [key, value] of Object.entries(routing)) {
    const nk = normalize(key)
    if (!normalizedRouting.has(nk)) {
      normalizedRouting.set(nk, value)
    }
  }

  const candidates = [agentName, subagentType, 'default'].filter(
    Boolean,
  ) as string[]
  for (const candidate of candidates) {
    const match = normalizedRouting.get(normalize(candidate))
    if (match) return match
  }
  return undefined
}

function pickCoderPreferring(
  models: NonNullable<SettingsJson['agentModels']>,
  preferred: string | undefined,
  tier: TaskTier,
  taskRouting: SettingsJson['taskRouting'],
): string | undefined {
  if (preferred && /coder|code/i.test(preferred) && models[preferred]) {
    return preferred
  }
  // Prefer any registered model with coder/code in the name for this tier
  const tierCandidate = taskRouting?.[tier]
  if (tierCandidate && /coder|code/i.test(tierCandidate) && models[tierCandidate]) {
    return tierCandidate
  }
  for (const name of Object.keys(models)) {
    if (/coder|code/i.test(name)) return name
  }
  return preferred
}

function applyModeBias(
  mode: AutonomyMode,
  tier: TaskTier,
  modelName: string | undefined,
  settings: SettingsJson,
): { model: string | undefined; reasons: string[] } {
  const reasons: string[] = []
  const models = settings.agentModels
  const taskRouting = settings.taskRouting
  if (!models || !modelName) return { model: modelName, reasons }

  if (mode === 'fast' && tier === 'hard' && taskRouting?.standard) {
    const std = taskRouting.standard
    if (lookupModelConfig(models, std)) {
      reasons.push('mode=fast: downgraded hard → standard')
      return { model: std, reasons }
    }
  }

  if (mode === 'quality' && (tier === 'trivial' || tier === 'standard')) {
    const hard = taskRouting?.hard
    if (hard && lookupModelConfig(models, hard)) {
      reasons.push(`mode=quality: upgraded ${tier} → hard`)
      return { model: hard, reasons }
    }
  }

  if (mode === 'code') {
    const picked = pickCoderPreferring(models, modelName, tier, taskRouting)
    if (picked && picked !== modelName) {
      reasons.push(`mode=code: preferred coder model ${picked}`)
      return { model: picked, reasons }
    }
  }

  return { model: modelName, reasons }
}

function effortForTier(tier: TaskTier): RouteDecision['effort'] {
  switch (tier) {
    case 'trivial':
      return 'low'
    case 'standard':
      return 'medium'
    case 'hard':
    case 'vision':
      return 'high'
  }
}

/**
 * Resolve a route from task tier + autonomy policy.
 * Returns null when autonomy should not override (caller uses legacy routing).
 */
export function resolveTaskRoute(
  input: ResolveTaskRouteInput,
): RouteDecision | null {
  const { settings, tier, userPinnedModel } = input
  const models = settings.agentModels
  if (!models) return null

  if (!isAutonomyEnabled(settings)) return null

  const mode = resolveAutonomyMode(settings, input.modeOverride)
  if (mode === 'fixed') return null

  const classifier = settings.autonomy?.classifier ?? 'heuristic'
  if (classifier === 'off' && !userPinnedModel) {
    // Still allow pinned; otherwise fall back to legacy
    return null
  }

  const reasons: string[] = [`tier=${tier}`, `mode=${mode}`]

  if (userPinnedModel) {
    const cfg = lookupModelConfig(models, userPinnedModel)
    if (!cfg) return null
    const chain =
      settings.fallbackChains?.[tier] ??
      settings.fallbackChains?.default ??
      []
    return {
      model: userPinnedModel,
      baseURL: cfg.base_url,
      apiKey: cfg.api_key,
      effort: effortForTier(tier),
      tier,
      reason: [...reasons, 'user-pinned model'],
      fallbackChain: chain.filter(m => m !== userPinnedModel),
      source: 'static',
    }
  }

  // Primary: taskRouting[tier]
  let modelName: string | undefined = settings.taskRouting?.[tier]

  if (modelName) {
    reasons.push(`taskRouting.${tier}=${modelName}`)
  } else {
    // Fallback to legacy agent routing for a model name
    modelName = resolveLegacyAgentModel(
      settings,
      input.agentName,
      input.subagentType,
    )
    if (modelName) {
      reasons.push(`legacy agentRouting → ${modelName}`)
    }
  }

  const biased = applyModeBias(mode, tier, modelName, settings)
  modelName = biased.model
  reasons.push(...biased.reasons)

  if (!modelName) return null

  const cfg = lookupModelConfig(models, modelName)
  if (!cfg) {
    reasons.push(`model ${modelName} missing from agentModels`)
    return null
  }

  const chain =
    settings.fallbackChains?.[tier] ??
    settings.fallbackChains?.default ??
    []

  return {
    model: modelName,
    baseURL: cfg.base_url,
    apiKey: cfg.api_key,
    effort: effortForTier(tier),
    tier,
    reason: reasons,
    fallbackChain: chain.filter(m => m !== modelName),
    source: 'policy',
  }
}
