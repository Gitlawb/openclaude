export const EXPLICIT_PROVIDER_ENV_VAR = 'CLAUDE_CODE_EXPLICIT_PROVIDER'

const PROVIDER_FLAG_KEYS = [
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const

export function clearProviderSelectionFlags(
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const key of PROVIDER_FLAG_KEYS) {
    delete env[key]
  }
}

function getExplicitProvider(processEnv: NodeJS.ProcessEnv): string | undefined {
  return processEnv[EXPLICIT_PROVIDER_ENV_VAR]?.trim() || undefined
}

function isGithubModel(model: string | undefined): boolean {
  return (model ?? '').trim().toLowerCase().startsWith('github:')
}

export function filterSettingsEnvForExplicitProvider(
  env: Record<string, string> | undefined,
  processEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (!env) return {}

  const explicitProvider = getExplicitProvider(processEnv)
  if (!explicitProvider) {
    return env
  }

  const filtered = { ...env }
  for (const key of PROVIDER_FLAG_KEYS) {
    delete filtered[key]
  }

  if (explicitProvider === 'ollama') {
    delete filtered.OPENAI_BASE_URL
    delete filtered.OPENAI_MODEL
    delete filtered.OPENAI_API_KEY
    return filtered
  }

  if (explicitProvider === 'github') {
    if (!isGithubModel(filtered.OPENAI_MODEL)) {
      delete filtered.OPENAI_MODEL
    }
    return filtered
  }

  if (isGithubModel(filtered.OPENAI_MODEL)) {
    delete filtered.OPENAI_MODEL
  }

  return filtered
}
