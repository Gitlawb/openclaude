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
  resetAimlapiCheckoutSessionAsync,
  clearAimlapiTopupState,
  clearAimlapiTopupStateAsync,
  discardAimlapiCheckoutState,
  discardAimlapiCheckoutStateAsync,
  loadAimlapiTopupState,
  type AimlapiTopupIntent,
  type AimlapiPersistedTopup,
  type AimlapiCheckoutState,
  type AimlapiDiscardResult,
} from './topupState.js'
// NOTE: the sign-in-key cache (`{load,save,clear}AimlapiSignInKey`) is defined
// in ./topupState.js but intentionally NOT re-exported here: it is a persistence
// primitive for the guided passwordless flow that lands in a follow-up PR, and
// has no in-tree consumer yet. It is exposed publicly only once that flow wires
// it, to keep this stack's API surface to what it actually uses.
