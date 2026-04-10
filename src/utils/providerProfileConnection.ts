import type { ProviderProfileInput } from './providerProfiles.js'

type ConnectionTestResult =
  | { ok: true }
  | { ok: false; message: string }

type ValidateModelFn = (
  model: string,
  options?: { signal?: AbortSignal },
) => Promise<{ valid: boolean; error?: string }>

async function defaultValidateModel(
  model: string,
  options?: { signal?: AbortSignal },
): Promise<{ valid: boolean; error?: string }> {
  const { clearValidModelCache, validateModel } = await import(
    './model/validateModel.js'
  )
  // Clear the cache so the request actually hits the new provider endpoint
  // instead of returning a stale success from a previous provider.
  clearValidModelCache()
  return validateModel(model, options)
}

function trimValue(value: string | undefined): string {
  return value?.trim() ?? ''
}

function setOptionalEnvValue(key: string, value: string | undefined): void {
  const trimmed = trimValue(value)
  if (trimmed) {
    process.env[key] = trimmed
  } else {
    delete process.env[key]
  }
}

// Auth-related env vars that must be suppressed during connection tests
// so that the entered API key is actually validated instead of being
// bypassed by an active Claude.ai subscriber session or a pre-existing
// bearer token.
//
// These correspond to the token sources checked in auth.ts
// (getAuthTokenSource / getClaudeAIOAuthTokens) and the bearer-token
// fallback in client.ts (configureApiKeyHeaders).  If a new auth env var
// is added there, it should be added here as well.
//
// LIMITATION: If the user authenticated via keychain/secure-storage OAuth
// (not env vars), the memoized token from getClaudeAIOAuthTokens() will
// still be used.  The env var suppression only covers env-var-based auth.
const AUTH_ENV_KEYS_TO_SUPPRESS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'ANTHROPIC_AUTH_TOKEN',
]

function deleteEnvKeys(keys: string[]): void {
  for (const key of keys) {
    delete process.env[key]
  }
}

function restoreProcessEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function applyProfileToProcessEnv(input: ProviderProfileInput): void {
  deleteEnvKeys([
    'CLAUDE_CODE_USE_GEMINI',
    'CLAUDE_CODE_USE_GITHUB',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'OPENAI_ORG',
    'OPENAI_PROJECT',
    'OPENAI_ORGANIZATION',
  ])

  if (input.provider === 'anthropic') {
    deleteEnvKeys([
      'CLAUDE_CODE_USE_OPENAI',
      'OPENAI_BASE_URL',
      'OPENAI_API_BASE',
      'OPENAI_MODEL',
      'OPENAI_API_KEY',
    ])

    process.env.ANTHROPIC_BASE_URL = trimValue(input.baseUrl)
    process.env.ANTHROPIC_MODEL = trimValue(input.model)
    setOptionalEnvValue('ANTHROPIC_API_KEY', input.apiKey)
    return
  }

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = trimValue(input.baseUrl)
  process.env.OPENAI_MODEL = trimValue(input.model)
  setOptionalEnvValue('OPENAI_API_KEY', input.apiKey)

  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_MODEL
  delete process.env.ANTHROPIC_API_KEY
}

/**
 * Test a provider profile by temporarily applying its env vars and running
 * a minimal API validation request.
 *
 * **Not safe for concurrent use** — mutates `process.env` for the duration
 * of the test and restores it in a `finally` block.  Only one connection
 * test should be in-flight at a time (enforced by the UI via testEpochRef).
 */
export async function testProviderProfileConnection(
  input: ProviderProfileInput,
  options?: {
    validateModel?: ValidateModelFn
    signal?: AbortSignal
  },
): Promise<ConnectionTestResult> {
  const baseUrl = trimValue(input.baseUrl)
  const model = trimValue(input.model)

  if (!baseUrl || !model) {
    return {
      ok: false,
      message: 'Base URL and model are required before testing the provider.',
    }
  }

  const previousEnv = { ...process.env }

  try {
    // Suppress OAuth tokens so getAnthropicClient() falls through to
    // API-key auth, ensuring the entered key is actually exercised.
    deleteEnvKeys(AUTH_ENV_KEYS_TO_SUPPRESS)

    applyProfileToProcessEnv({
      ...input,
      baseUrl,
      model,
      apiKey: trimValue(input.apiKey),
    })

    const validate = options?.validateModel ?? defaultValidateModel
    const result = await validate(model, { signal: options?.signal })
    if (!result.valid) {
      return {
        ok: false,
        message: result.error ?? 'Provider test failed.',
      }
    }

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  } finally {
    restoreProcessEnv(previousEnv)
  }
}
