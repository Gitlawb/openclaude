export const AIMLAPI_PROVIDER_ID = 'aimlapi' as const
export const AIMLAPI_LABEL = 'AI/ML API'
export const AIMLAPI_DEFAULT_BASE_URL = 'https://api.aimlapi.com/v1'
export const AIMLAPI_DEFAULT_MODEL = 'gpt-4o'
export const AIMLAPI_API_KEY_ENV = 'AIMLAPI_API_KEY'

export const AIMLAPI_ATTRIBUTION_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'OpenClaude',
  'X-Title': 'OpenClaude',
}

export const AIMLAPI_PROVIDER_PRESET_OPTION = {
  value: AIMLAPI_PROVIDER_ID,
  label: AIMLAPI_LABEL,
  description: 'AI/ML API OpenAI-compatible endpoint',
} as const

export type AimlapiEnv = {
  AIMLAPI_API_KEY?: string
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
}

export type AimlapiModelCatalogPayload = {
  data?: Array<{
    id?: string
    type?: string
    info?: {
      name?: string
      developer?: string
      contextLength?: number
    }
  }>
}

export type AimlapiModelOption = {
  value: string
  label: string
  description: string
}

export function isAimlapiBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === 'api.aimlapi.com'
  } catch {
    return false
  }
}

export function getAimlapiApiKey(env: AimlapiEnv = process.env): string {
  return env.AIMLAPI_API_KEY ?? env.OPENAI_API_KEY ?? ''
}

export function getAimlapiOpenAICompatibleApiKey(
  baseUrl: string | undefined,
  env: AimlapiEnv = process.env,
): string | undefined {
  if (!isAimlapiBaseUrl(baseUrl)) return undefined
  return env.AIMLAPI_API_KEY
}

export function getAimlapiAttributionHeaders(
  baseUrl: string | undefined,
): Record<string, string> {
  return isAimlapiBaseUrl(baseUrl) ? AIMLAPI_ATTRIBUTION_HEADERS : {}
}

export function hasAimlapiApiKey(
  baseUrl: string | undefined,
  env: AimlapiEnv = process.env,
): boolean {
  return isAimlapiBaseUrl(baseUrl) && !!env.AIMLAPI_API_KEY?.trim()
}

export function syncAimlapiOpenAIEnv(env: AimlapiEnv = process.env): void {
  if (
    isAimlapiBaseUrl(env.OPENAI_BASE_URL) &&
    !env.OPENAI_API_KEY &&
    env.AIMLAPI_API_KEY
  ) {
    env.OPENAI_API_KEY = env.AIMLAPI_API_KEY
  }
}

export function getAimlapiPresetDefaults(env: AimlapiEnv = process.env) {
  return {
    provider: 'openai' as const,
    name: AIMLAPI_LABEL,
    baseUrl: AIMLAPI_DEFAULT_BASE_URL,
    model: AIMLAPI_DEFAULT_MODEL,
    apiKey: getAimlapiApiKey(env),
    requiresApiKey: true,
  }
}

export function mapAimlapiModelCatalog(
  payload: AimlapiModelCatalogPayload,
): AimlapiModelOption[] {
  const seen = new Set<string>()
  const models: AimlapiModelOption[] = []

  for (const model of payload.data ?? []) {
    if (!model.id || seen.has(model.id)) {
      continue
    }
    if (model.type !== 'openai/chat-completions') {
      continue
    }

    seen.add(model.id)
    const details = [
      model.info?.developer,
      typeof model.info?.contextLength === 'number'
        ? `${model.info.contextLength} context`
        : undefined,
    ].filter((part): part is string => Boolean(part))

    models.push({
      value: model.id,
      label: model.info?.name || model.id,
      description:
        details.length > 0 ? details.join(' - ') : `Detected from ${AIMLAPI_LABEL}`,
    })
  }

  return models
}
