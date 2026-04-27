import { get as fetchGithubCopilotModels, type GithubCopilotModel } from '../../github-copilot/models.js'
import { readGithubModelsTokenAsync } from '../githubModelsCredentials.js'

type ModelOption = {
  value: string
  label: string
  description: string
  descriptionForModel?: string
}

const GITHUB_COPILOT_BASE_URL = 'https://api.githubcopilot.com'

const COPILOT_HEADERS: Record<string, string> = {
  Authorization: '',
  'Copilot-Integration-Id': 'vscode-chat',
}

let cachedGithubModels: Record<string, GithubCopilotModel> | null = null
let fetchPromise: Promise<Record<string, GithubCopilotModel>> | null = null

function toModelOptions(models: Record<string, GithubCopilotModel>): ModelOption[] {
  return Object.values(models).map(model => ({
    value: model.api.id,
    label: model.name,
    description: `GitHub Copilot · ${model.family}`,
    descriptionForModel: `${model.name} (${model.api.id})`,
  }))
}

async function resolveGithubToken(): Promise<string | undefined> {
  const envToken = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (envToken) {
    return envToken
  }

  return readGithubModelsTokenAsync()
}

async function fetchGithubModels(): Promise<Record<string, GithubCopilotModel>> {
  const token = await resolveGithubToken()
  if (!token) {
    throw new Error('GitHub Copilot token not found. Set GITHUB_TOKEN, GH_TOKEN, or sign in first.')
  }

  const headers: HeadersInit = {
    ...COPILOT_HEADERS,
    Authorization: `Bearer ${token}`,
  }

  return fetchGithubCopilotModels(GITHUB_COPILOT_BASE_URL, headers, cachedGithubModels ?? {})
}

export async function refreshGithubModelsCache(): Promise<ModelOption[]> {
  if (!fetchPromise) {
    fetchPromise = fetchGithubModels()
      .then(models => {
        cachedGithubModels = models
        return models
      })
      .finally(() => {
        fetchPromise = null
      })
  }

  const models = await fetchPromise
  return toModelOptions(models)
}

export function prefetchGithubModels(): void {
  void refreshGithubModelsCache()
}

export function getCachedGithubModelOptions(): ModelOption[] {
  return cachedGithubModels ? toModelOptions(cachedGithubModels) : []
}
