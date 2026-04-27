import type { ModelOption } from './modelOptions.js'
import { readGithubModelsTokenAsync } from '../githubModelsCredentials.js'
import { GITHUB_COPILOT_BASE_URL } from '../../services/api/providerConfig.js'

const COPILOT_HEADERS: Record<string, string> = {
  'User-Agent': 'GitHubCopilotChat/0.26.7',
  'Editor-Version': 'vscode/1.99.3',
  'Editor-Plugin-Version': 'copilot-chat/0.26.7',
  'Copilot-Integration-Id': 'vscode-chat',
}

let cachedGithubOptions: ModelOption[] | null = null
let fetchPromise: Promise<ModelOption[]> | null = null

type GithubModelPolicy = {
  state?: string
}

type GithubModelResponseItem = {
  id: string
  name?: string
  summary?: string
  publisher?: string
  model_picker_enabled?: boolean
  policy?: GithubModelPolicy
}

function resolveCopilotModelsUrl(): string {
  const rawBaseUrl = process.env.OPENAI_BASE_URL?.trim()
  if (!rawBaseUrl) {
    return `${GITHUB_COPILOT_BASE_URL}/models`
  }

  try {
    const parsed = new URL(rawBaseUrl)
    if (parsed.hostname.toLowerCase() === 'api.githubcopilot.com') {
      return `${parsed.origin}/models`
    }
  } catch {
    // Fall back to the canonical Copilot API endpoint.
  }

  return `${GITHUB_COPILOT_BASE_URL}/models`
}

export async function fetchGithubModels(): Promise<ModelOption[]> {
  let token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (!token) {
    token = await readGithubModelsTokenAsync()
  }
  if (!token) return []

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(resolveCopilotModelsUrl(), {
      method: 'GET',
      headers: {
        ...COPILOT_HEADERS,
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
      },
      signal: controller.signal,
    })
    if (!response.ok) return []

    const payload = (await response.json()) as
      | GithubModelResponseItem[]
      | { data?: GithubModelResponseItem[] }
    const data = Array.isArray(payload) ? payload : (payload.data ?? [])

    const planEligibleModels = data.filter(
      model => model.model_picker_enabled && model.policy?.state !== 'disabled',
    )

    return planEligibleModels.map(model => {
      const name = model.name || model.id
      const desc = model.summary
        ? `GitHub Models · ${model.summary}`
        : `GitHub model by ${model.publisher || 'unknown'}`
      return {
        value: model.id,
        label: name,
        description: desc,
      }
    })
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

export async function refreshGithubModelsCache(): Promise<ModelOption[]> {
  if (fetchPromise) {
    return fetchPromise
  }

  fetchPromise = fetchGithubModels()
    .then(options => {
      cachedGithubOptions = options
      return options
    })
    .finally(() => {
      fetchPromise = null
    })

  return fetchPromise
}

export function prefetchGithubModels(): void {
  // Proceed if GitHub token or mode might be active
  if (cachedGithubOptions && cachedGithubOptions.length > 0) return
  void refreshGithubModelsCache()
}

export function getCachedGithubModelOptions(): ModelOption[] {
  const options = cachedGithubOptions ?? []
  return options.filter(opt => !isGithubModelUnsupported(opt.value))
}

const unsupportedGithubModels = new Set<string>()

/**
 * Mark a model as unsupported for the current session (e.g. after a 400 model_not_supported).
 * NOTE: This is a runtime workaround because the GitHub /models endpoint doesn't always
 * accurately reflect plan-specific model restrictions.
 */
export function markGithubModelUnsupported(model: string): void {
  const normalized = model.toLowerCase()
  console.log(`[githubModels] Marking model as unsupported: ${normalized}`)
  unsupportedGithubModels.add(normalized)
}

/**
 * Check if a model has been marked as unsupported for the current session.
 */
export function isGithubModelUnsupported(model: string): boolean {
  const normalized = model.toLowerCase()
  const result = unsupportedGithubModels.has(normalized)
  if (result) {
    console.log(`[githubModels] Model ${normalized} is marked as unsupported`)
  }
  return result
}
