import type { ModelOption } from './modelOptions.js'
import { readGithubModelsTokenAsync } from '../githubModelsCredentials.js'

let cachedGithubOptions: ModelOption[] | null = null
let fetchPromise: Promise<ModelOption[]> | null = null

export async function fetchGithubModels(): Promise<ModelOption[]> {
  let token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (!token) {
    token = await readGithubModelsTokenAsync()
  }
  if (!token) return []

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch('https://models.github.ai/catalog/models', {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
      },
      signal: controller.signal,
    })
    if (!response.ok) return []

    const data = (await response.json()) as Array<{
      id: string;
      name?: string;
      summary?: string;
      publisher?: string;
    }>

    return data.map(m => {
      const name = m.name || m.id;
      const desc = m.summary ? `GitHub Models · ${m.summary}` : `GitHub model by ${m.publisher || 'unknown'}`;
      return {
        value: m.id,
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

export function prefetchGithubModels(): void {
  // Proceed if GitHub token or mode might be active
  if (cachedGithubOptions && cachedGithubOptions.length > 0) return
  if (fetchPromise) return
  fetchPromise = fetchGithubModels()
    .then(options => {
      cachedGithubOptions = options
      return options
    })
    .finally(() => {
      fetchPromise = null
    })
}

export function getCachedGithubModelOptions(): ModelOption[] {
  return cachedGithubOptions ?? []
}
