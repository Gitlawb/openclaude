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
  lowBalance: boolean
}

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
): Promise<AimlapiCodeSignInResult> {
  const client = clientForInferenceBaseUrl(inferenceBaseUrl)
  const auth = await client.verifySignInCode(email, code, signal)
  const created = await client.createKey(auth.token, 'OpenClaude CLI', signal)
  let lowBalance = false
  try {
    lowBalance = (await client.getBalance(created.key, signal)).lowBalance
  } catch (error) {
    if (signal?.aborted) throw error
    // The key is already issued; a balance read failure must not discard it.
  }
  return {
    sessionToken: auth.token,
    apiKey: created.key,
    apiKeyId: created.id,
    lowBalance,
  }
}
