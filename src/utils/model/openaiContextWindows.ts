/**
 * Runtime overrides for OpenAI-compatible model limits.
 *
 * Built-in model limits, including legacy aliases, live in
 * src/integrations/models. These helpers preserve the documented JSON env
 * override path for custom/private deployments and a `modelLimits` settings
 * map for the same effect via settings.json.
 *
 * Resolution order: env var → settings.json `modelLimits` → built-in catalog.
 */

import { getGlobalConfig } from '../config.js'

type LimitEnvVar =
  | 'CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS'
  | 'CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS'

type SettingsLimitKey = 'contextWindow' | 'maxOutputTokens'

function readExternalLimits(
  envVarName: LimitEnvVar,
  processEnv: NodeJS.ProcessEnv,
): Record<string, number> {
  const raw = processEnv[envVarName]
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          (entry): entry is [string, number] =>
            typeof entry[0] === 'string' &&
            typeof entry[1] === 'number' &&
            Number.isFinite(entry[1]) &&
            entry[1] > 0,
        )
        .map(([key, value]) => [key.trim(), value])
        .filter(([key]) => key.length > 0),
    )
  } catch {
    return {}
  }
}

function lookupExactByKey(
  entries: Record<string, number>,
  key: string | undefined,
): number | undefined {
  const normalizedKey = key?.trim()
  if (!normalizedKey) {
    return undefined
  }

  return entries[normalizedKey] ?? entries[normalizedKey.toLowerCase()]
}

function lookupPrefixByKey(
  entries: Record<string, number>,
  key: string | undefined,
): number | undefined {
  const normalizedKey = key?.trim()
  if (!normalizedKey) {
    return undefined
  }

  const prefixKey = Object.keys(entries)
    .sort((left, right) => right.length - left.length)
    .find(entryKey => normalizedKey.startsWith(entryKey))

  return prefixKey ? entries[prefixKey] : undefined
}

function getOpenAIBaseUrlHost(processEnv: NodeJS.ProcessEnv): string | undefined {
  const baseUrl =
    processEnv.OPENAI_BASE_URL?.trim() || processEnv.OPENAI_API_BASE?.trim()
  if (!baseUrl) {
    return undefined
  }

  try {
    return new URL(baseUrl).host
  } catch {
    return undefined
  }
}

function lookupByModel(
  entries: Record<string, number>,
  model: string | undefined,
  processEnv: NodeJS.ProcessEnv,
): number | undefined {
  const modelName = model?.trim() || processEnv.OPENAI_MODEL?.trim()
  const baseUrlHost = getOpenAIBaseUrlHost(processEnv)
  const hostQualifiedModel =
    baseUrlHost && modelName ? `${baseUrlHost}:${modelName}` : undefined

  return (
    lookupExactByKey(entries, hostQualifiedModel) ??
    lookupExactByKey(entries, modelName) ??
    lookupPrefixByKey(entries, hostQualifiedModel) ??
    lookupPrefixByKey(entries, modelName)
  )
}

function lookupExternalLimit(
  envVarName: LimitEnvVar,
  model: string | undefined,
  processEnv: NodeJS.ProcessEnv,
): number | undefined {
  return lookupByModel(
    readExternalLimits(envVarName, processEnv),
    model,
    processEnv,
  )
}

function readSettingsLimits(key: SettingsLimitKey): Record<string, number> {
  let limits: unknown
  try {
    limits = getGlobalConfig().modelLimits
  } catch {
    return {}
  }
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    return {}
  }
  const result: Record<string, number> = {}
  for (const [modelName, entry] of Object.entries(limits)) {
    if (!entry || typeof entry !== 'object') continue
    const value = (entry as Record<string, unknown>)[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      const trimmed = modelName.trim()
      if (trimmed.length > 0) {
        result[trimmed] = value
      }
    }
  }
  return result
}

function lookupSettingsLimit(
  key: SettingsLimitKey,
  model: string | undefined,
  processEnv: NodeJS.ProcessEnv,
): number | undefined {
  return lookupByModel(readSettingsLimits(key), model, processEnv)
}

export function getOpenAIContextWindow(
  model: string | undefined,
  processEnv: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return (
    lookupExternalLimit(
      'CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS',
      model,
      processEnv,
    ) ?? lookupSettingsLimit('contextWindow', model, processEnv)
  )
}

export function getOpenAIMaxOutputTokens(
  model: string | undefined,
  processEnv: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return (
    lookupExternalLimit(
      'CLAUDE_CODE_OPENAI_MAX_OUTPUT_TOKENS',
      model,
      processEnv,
    ) ?? lookupSettingsLimit('maxOutputTokens', model, processEnv)
  )
}
