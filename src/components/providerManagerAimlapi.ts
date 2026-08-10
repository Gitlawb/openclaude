/**
 * Indirection layer between ProviderManager and the aimlapi integration. The GUI
 * imports the top-up / onboarding / checkout-state functions from HERE so tests
 * can swap them out by mocking this single module, instead of a process-global
 * `mock.module` of the integration barrel (which leaks across test files).
 */

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
  claimAimlapiTopupStateAsync as claimAimlapiTopupStateAsyncImpl,
  clearAimlapiTopupStateAsync as clearAimlapiTopupStateAsyncImpl,
  recordAimlapiCheckoutSession as recordAimlapiCheckoutSessionImpl,
  resetAimlapiCheckoutSessionAsync as resetAimlapiCheckoutSessionAsyncImpl,
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

export const provisionAimlapiKey: typeof provisionAimlapiKeyImpl = (...args) =>
  provisionAimlapiKeyImpl(...args)

export const topUpAimlapiByApiKey: typeof topUpAimlapiByApiKeyImpl = (...args) =>
  topUpAimlapiByApiKeyImpl(...args)

export const parseAimlapiAmountUsd: typeof parseAimlapiAmountUsdImpl = (...args) =>
  parseAimlapiAmountUsdImpl(...args)

export const isValidAimlapiEmail: typeof isValidAimlapiEmailImpl = (...args) =>
  isValidAimlapiEmailImpl(...args)

export const beginAimlapiEmailOnboarding: typeof beginAimlapiEmailOnboardingImpl = (
  ...args
) => beginAimlapiEmailOnboardingImpl(...args)

export const completeAimlapiCodeSignIn: typeof completeAimlapiCodeSignInImpl = (
  ...args
) => completeAimlapiCodeSignInImpl(...args)

export const validateAimlapiApiKey: typeof validateAimlapiApiKeyImpl = (...args) =>
  validateAimlapiApiKeyImpl(...args)

export const claimAimlapiTopupStateAsync: typeof claimAimlapiTopupStateAsyncImpl = (
  ...args
) => claimAimlapiTopupStateAsyncImpl(...args)

export const clearAimlapiTopupStateAsync: typeof clearAimlapiTopupStateAsyncImpl = (
  ...args
) => clearAimlapiTopupStateAsyncImpl(...args)

export const recordAimlapiCheckoutSession: typeof recordAimlapiCheckoutSessionImpl = (
  ...args
) => recordAimlapiCheckoutSessionImpl(...args)

export const resetAimlapiCheckoutSessionAsync: typeof resetAimlapiCheckoutSessionAsyncImpl = (
  ...args
) => resetAimlapiCheckoutSessionAsyncImpl(...args)

export const saveAimlapiTopupState: typeof saveAimlapiTopupStateImpl = (...args) =>
  saveAimlapiTopupStateImpl(...args)

export const loadAimlapiSignInKey: typeof loadAimlapiSignInKeyImpl = (...args) =>
  loadAimlapiSignInKeyImpl(...args)

export const saveAimlapiSignInKey: typeof saveAimlapiSignInKeyImpl = (...args) =>
  saveAimlapiSignInKeyImpl(...args)

export const clearAimlapiSignInKey: typeof clearAimlapiSignInKeyImpl = (...args) =>
  clearAimlapiSignInKeyImpl(...args)
