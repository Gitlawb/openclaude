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
// Checkout-resume persistence, consumed by both top-up entry points in
// ./topup.ts: the CLI flow (`runAimlapiTopup`) and the guided GUI flow
// (`provisionAimlapiKey`). A caller that receives a settled recovery receipt
// (the GUI flow returns a `clearReceipt` closure for this) MUST retire it with
// `clearAimlapiTopupState` once it has durably persisted the issued key.
export {
  claimAimlapiTopupState,
  claimAimlapiTopupStateAsync,
  saveAimlapiTopupState,
  saveAimlapiTopupStateAsync,
  recordAimlapiCheckoutSession,
  recordAimlapiCheckoutSessionAsync,
  resetAimlapiCheckoutSession,
  clearAimlapiTopupState,
  clearAimlapiTopupStateAsync,
  loadAimlapiTopupState,
  loadAimlapiSignInKey,
  saveAimlapiSignInKey,
  clearAimlapiSignInKey,
  type AimlapiTopupIntent,
  type AimlapiPersistedTopup,
  type AimlapiCheckoutState,
} from './topupState.js'
