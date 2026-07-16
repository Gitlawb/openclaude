import {
  provisionAimlapiKey as provisionAimlapiKeyImpl,
  topUpAimlapiByApiKey as topUpAimlapiByApiKeyImpl,
  parseAimlapiAmountUsd as parseAimlapiAmountUsdImpl,
  isValidAimlapiEmail as isValidAimlapiEmailImpl,
  beginAimlapiEmailOnboarding as beginAimlapiEmailOnboardingImpl,
  completeAimlapiCodeSignIn as completeAimlapiCodeSignInImpl,
  validateAimlapiApiKey as validateAimlapiApiKeyImpl,
} from '../integrations/aimlapi/index.js'

export {
  AimlapiApiError,
  AIMLAPI_MESSAGES,
  type AimlapiTopupStatus,
} from '../integrations/aimlapi/index.js'

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
