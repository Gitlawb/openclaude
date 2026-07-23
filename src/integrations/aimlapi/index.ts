export {
  provisionAimlapiKey,
  runAimlapiTopup,
  type AimlapiProvisionOptions,
  type AimlapiProvisionedKey,
  type AimlapiTopupOptions,
  type AimlapiTopupStatus,
} from './topup.js'
export { AimlapiClient, AimlapiApiError } from './client.js'
export type {
  AimlapiEndpoints,
} from './config.js'
// Checkout-resume persistence. Exposed here so the public API is discoverable;
// it is consumed by the guided top-up flow, which migrates onto it in a
// follow-up PR (see PR stack). Until then it has no in-tree caller.
export {
  claimAimlapiTopupState,
  saveAimlapiTopupState,
  resetAimlapiCheckoutSession,
  clearAimlapiTopupState,
  loadAimlapiTopupState,
  loadAimlapiSignInKey,
  saveAimlapiSignInKey,
  clearAimlapiSignInKey,
  type AimlapiTopupIntent,
  type AimlapiPersistedTopup,
  type AimlapiCheckoutState,
} from './topupState.js'
