import {
  provisionAimlapiKey as provisionAimlapiKeyImpl,
  topUpAimlapiByApiKey as topUpAimlapiByApiKeyImpl,
  parseAimlapiAmountUsd as parseAimlapiAmountUsdImpl,
  isValidAimlapiEmail as isValidAimlapiEmailImpl,
  beginAimlapiEmailOnboarding as beginAimlapiEmailOnboardingImpl,
  completeAimlapiCodeSignIn as completeAimlapiCodeSignInImpl,
  validateAimlapiApiKey as validateAimlapiApiKeyImpl,
} from '../integrations/aimlapi/index.js'
import {
  claimAimlapiTopupState as claimAimlapiTopupStateImpl,
  clearAimlapiTopupState as clearAimlapiTopupStateImpl,
  saveAimlapiTopupState as saveAimlapiTopupStateImpl,
  loadAimlapiSignInKey as loadAimlapiSignInKeyImpl,
  saveAimlapiSignInKey as saveAimlapiSignInKeyImpl,
  clearAimlapiSignInKey as clearAimlapiSignInKeyImpl,
} from '../integrations/aimlapi/topupState.js'
import type {
  AimlapiPersistedTopup,
  AimlapiTopupIntent,
} from '../integrations/aimlapi/topupState.js'

export {
  AimlapiApiError,
  AIMLAPI_MESSAGES,
  type AimlapiTopupStatus,
} from '../integrations/aimlapi/index.js'
export type { AimlapiPersistedTopup, AimlapiTopupIntent }

export const provisionAimlapiKey: typeof provisionAimlapiKeyImpl = options =>
  provisionAimlapiKeyImpl(options)

export const topUpAimlapiByApiKey: typeof topUpAimlapiByApiKeyImpl = options =>
  topUpAimlapiByApiKeyImpl(options)

export const parseAimlapiAmountUsd: typeof parseAimlapiAmountUsdImpl = value =>
  parseAimlapiAmountUsdImpl(value)

export const isValidAimlapiEmail: typeof isValidAimlapiEmailImpl = value =>
  isValidAimlapiEmailImpl(value)

export const beginAimlapiEmailOnboarding: typeof beginAimlapiEmailOnboardingImpl = (
  ...args
) => beginAimlapiEmailOnboardingImpl(...args)

export const completeAimlapiCodeSignIn: typeof completeAimlapiCodeSignInImpl = (
  ...args
) => completeAimlapiCodeSignInImpl(...args)

export const validateAimlapiApiKey: typeof validateAimlapiApiKeyImpl = (...args) =>
  validateAimlapiApiKeyImpl(...args)

export const claimAimlapiTopupState: typeof claimAimlapiTopupStateImpl = intent =>
  claimAimlapiTopupStateImpl(intent)

export const clearAimlapiTopupState: typeof clearAimlapiTopupStateImpl = intent =>
  clearAimlapiTopupStateImpl(intent)

export const saveAimlapiTopupState: typeof saveAimlapiTopupStateImpl = state =>
  saveAimlapiTopupStateImpl(state)

export const loadAimlapiSignInKey: typeof loadAimlapiSignInKeyImpl = email =>
  loadAimlapiSignInKeyImpl(email)

export const saveAimlapiSignInKey: typeof saveAimlapiSignInKeyImpl = (
  email,
  apiKey,
  apiKeyId,
) => saveAimlapiSignInKeyImpl(email, apiKey, apiKeyId)

export const clearAimlapiSignInKey: typeof clearAimlapiSignInKeyImpl = (
  email,
  apiKeyId,
) => clearAimlapiSignInKeyImpl(email, apiKeyId)
