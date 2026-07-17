import { AimlapiClient, type BalanceResult } from './client.js'
import { resolveEndpoints } from './config.js'

function clientForInferenceBaseUrl(inferenceBaseUrl?: string): AimlapiClient {
  const endpoints = resolveEndpoints()
  if (inferenceBaseUrl?.trim()) endpoints.inferenceBaseUrl = inferenceBaseUrl.trim()
  return new AimlapiClient(endpoints)
}

export type AimlapiEmailOnboardingResult =
  | { action: 'code-sent' }
  | { action: 'new-account'; sessionToken: string }

export type AimlapiCodeSignInResult = {
  sessionToken: string
  apiKey: string
  apiKeyId: string
} & (
  | { balanceStatus: 'confirmed'; lowBalance: boolean }
  | { balanceStatus: 'unknown'; balanceError: string }
)

export async function validateAimlapiApiKey(
  apiKey: string,
  signal?: AbortSignal,
  inferenceBaseUrl?: string,
): Promise<BalanceResult> {
  return clientForInferenceBaseUrl(inferenceBaseUrl).getBalance(apiKey.trim(), signal)
}

export async function beginAimlapiEmailOnboarding(
  email: string,
  signal?: AbortSignal,
): Promise<AimlapiEmailOnboardingResult> {
  const client = new AimlapiClient(resolveEndpoints())
  const account = await client.checkAccount(email, signal)
  switch (account.action) {
    case 'sign-in':
      await client.sendSignInCode(email, signal)
      return { action: 'code-sent' }
    case 'sign-up': {
      const auth = await client.createPasswordlessAccount(email, signal)
      return { action: 'new-account', sessionToken: auth.token }
    }
    default:
      throw new Error(`AI/ML API returned an unsupported account action.`)
  }
}

export async function completeAimlapiCodeSignIn(
  email: string,
  code: string,
  signal?: AbortSignal,
  inferenceBaseUrl?: string,
  existingKey?: { apiKey: string; apiKeyId: string },
): Promise<AimlapiCodeSignInResult> {
  const client = clientForInferenceBaseUrl(inferenceBaseUrl)
  const auth = await client.verifySignInCode(email, code, signal)
  let apiKey = existingKey?.apiKey?.trim() ?? ''
  let apiKeyId = existingKey?.apiKeyId ?? ''
  if (!apiKey) {
    // Reuse a previously issued key when one is supplied so a restart does not
    // mint a second key for the same account.
    const created = await client.createKey(auth.token, 'OpenClaude CLI', signal)
    apiKey = created.key
    apiKeyId = created.id
  }
  try {
    const balance = await client.getBalance(apiKey, signal)
    return {
      sessionToken: auth.token,
      apiKey,
      apiKeyId,
      balanceStatus: 'confirmed',
      lowBalance: balance.lowBalance,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    // The key is already issued; a balance read failure must not discard it.
    return {
      sessionToken: auth.token,
      apiKey,
      apiKeyId,
      balanceStatus: 'unknown',
      balanceError: error instanceof Error ? error.message : String(error),
    }
  }
}
