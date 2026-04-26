const ZAI_API_HOSTS = new Set([
  'api.z.ai',
])

const ZAI_GLM_MODEL_IDS = new Set([
  'GLM-5.1',
  'GLM-5-Turbo',
  'GLM-5',
  'GLM-4.7',
  'GLM-4.5-Air',
])

const ZAI_GLM_MODEL_IDS_LOWER = new Set(
  [...ZAI_GLM_MODEL_IDS].map(model => model.toLowerCase()),
)

export function isZaiBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    return ZAI_API_HOSTS.has(new URL(baseUrl).hostname.toLowerCase())
  } catch {
    return false
  }
}

export function isZaiGlmModel(model: string): boolean {
  return ZAI_GLM_MODEL_IDS_LOWER.has(model.trim().toLowerCase())
}

export function containsExactZaiGlmModelId(model: string): boolean {
  return model
    .split(',')
    .some(entry => ZAI_GLM_MODEL_IDS.has(entry.trim()))
}