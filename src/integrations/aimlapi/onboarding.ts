/**
 * Passwordless email onboarding helpers for the guided provider-manager flow:
 * discover whether an email signs in or signs up, complete a 6-digit code
 * sign-in (minting or reusing an existing-account key), and validate a pasted
 * key's balance. The CLI top-up flow (topup.ts) inlines the same steps.
 */

import { randomUUID } from 'node:crypto'

import { logForDebugging } from '../../utils/debug.js'
import { AimlapiClient, type BalanceResult } from './client.js'
import { resolveEndpoints } from './config.js'
import {
  acquireAimlapiSignInKeyLeaseAsync,
  releaseAimlapiSignInKeyLeaseAsync,
  saveAimlapiSignInKeyAsync,
} from './topupState.js'
import { abortError, isAmbiguousTransportApiError, sleep } from './transport.js'

function clientForInferenceBaseUrl(inferenceBaseUrl?: string): AimlapiClient {
  const endpoints = resolveEndpoints()
  if (inferenceBaseUrl?.trim()) endpoints.inferenceBaseUrl = inferenceBaseUrl.trim()
  return new AimlapiClient(endpoints)
}

const SIGN_IN_KEY_LEASE_POLL_INTERVAL_MS = 3000
// A single POST /v1/keys with no long poll before it; a few retry cycles
// covers a slow network or a couple of lease hand-offs.
const SIGN_IN_KEY_LEASE_POLL_TIMEOUT_MS = 2 * 60 * 1000

/**
 * Mint the sign-in key for this email under a cross-process lease so racing
 * ProviderManager instances never both call POST /v1/keys for the same
 * account before either caches its result — the loser adopts the winner's
 * cached key instead of minting (and orphaning) its own. See
 * `AimlapiSignInKeyLease`.
 */
async function mintOrAdoptSignInKey(
  client: AimlapiClient,
  email: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<{ apiKey: string; apiKeyId: string }> {
  const owner = randomUUID()
  const deadline = Date.now() + SIGN_IN_KEY_LEASE_POLL_TIMEOUT_MS
  for (;;) {
    if (signal?.aborted) throw abortError(signal)
    const lease = await acquireAimlapiSignInKeyLeaseAsync(email, owner)
    if (lease.status === 'cached') {
      return { apiKey: lease.apiKey, apiKeyId: lease.apiKeyId }
    }
    if (lease.status === 'acquired') {
      try {
        const created = await client.createKey(accessToken, 'OpenClaude CLI', signal)
        try {
          await saveAimlapiSignInKeyAsync(email, created.key, created.id)
        } catch {
          // Retained in memory below; the cache is only a recovery aid.
        }
        return { apiKey: created.key, apiKeyId: created.id }
      } catch (error) {
        // createKey is non-idempotent and exposes no retrieval-by-id
        // endpoint, so a transport-level failure is ambiguous: the POST may
        // have minted a key server-side before its response was lost, with
        // no way to recover that credential here. Releasing the lease in
        // that case would let a retry (or a racing peer) mint a second,
        // orphaned key. A caller-driven abort mid-flight is ambiguous too —
        // cancelling client-side does not stop the server from completing an
        // already-sent POST. A definite rejection means nothing was created,
        // so release immediately to let a retry proceed without waiting out
        // the stale window.
        if (!isAmbiguousTransportApiError(error) && !signal?.aborted) {
          await releaseAimlapiSignInKeyLeaseAsync(email, owner).catch((releaseError: unknown) => {
            logForDebugging(
              `Failed to release the AI/ML API sign-in key-mint lease: ${String(releaseError)}`,
              { level: 'warn' },
            )
          })
        }
        throw error
      }
    }
    // held: a live peer is minting; back off and re-attempt rather than
    // minting in parallel and orphaning a credential.
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for a concurrent sign-in key mint. Retry to resume.')
    }
    await sleep(SIGN_IN_KEY_LEASE_POLL_INTERVAL_MS, signal)
  }
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
      throw new Error('AI/ML API returned an unsupported account action.')
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
  let mintedKey = false
  if (!apiKey) {
    // Reuse a previously issued key when one is supplied so a restart does not
    // mint a second key for the same account.
    const minted = await mintOrAdoptSignInKey(client, email, auth.token, signal)
    apiKey = minted.apiKey
    apiKeyId = minted.apiKeyId
    mintedKey = true
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
    // A balance read failure must not discard an already-issued key. When THIS
    // call minted the key, even an aborted read returns it so the caller can
    // cache it — otherwise the next sign-in mints a second key for the account.
    // When the caller supplied the key it already holds it, so an abort can
    // propagate as usual.
    if (signal?.aborted && !mintedKey) throw error
    return {
      sessionToken: auth.token,
      apiKey,
      apiKeyId,
      balanceStatus: 'unknown',
      balanceError: error instanceof Error ? error.message : String(error),
    }
  }
}
