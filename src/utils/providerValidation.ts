import { resolve } from 'node:path'
import { isLocalProviderUrl, resolveProviderRequest } from '../services/api/providerConfig.js'
import { getGlobalClaudeFile } from './env.js'
import { PROFILE_FILE_NAME } from './providerProfile.js'

function getOpenAIMissingKeyMessage(): string {
  const globalConfigPath = getGlobalClaudeFile()
  const profilePath = resolve(process.cwd(), PROFILE_FILE_NAME)

  return [
    'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.',
    `To recover, run /provider and switch provider, or set CLAUDE_CODE_USE_OPENAI=0 in your shell environment.`,
    `Saved startup settings can come from ${globalConfigPath} or ${profilePath}.`,
  ].join('\n')
}

export async function getProviderValidationError(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const request = resolveProviderRequest({
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
  })

  if (env.OPENAI_API_KEY === 'SUA_CHAVE') {
    return 'Invalid OPENAI_API_KEY: placeholder value SUA_CHAVE detected. Set a real key or unset for local providers.'
  }

  if (!env.OPENAI_API_KEY && !isLocalProviderUrl(request.baseUrl)) {
    return getOpenAIMissingKeyMessage()
  }

  return null
}

export async function validateProviderEnvOrExit(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const error = await getProviderValidationError(env)
  if (error) {
    console.error(error)
    process.exit(1)
  }
}
