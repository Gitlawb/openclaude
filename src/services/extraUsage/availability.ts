import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { isOverageProvisioningAllowed } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

/** Billing extra-usage feature (browser / admin request), not the removed slash command. */
export function isExtraUsageProvisioningAllowed(): boolean {
  if (isEnvTruthy(process.env.DISABLE_EXTRA_USAGE_COMMAND)) {
    return false
  }
  return isOverageProvisioningAllowed()
}

/** Same gates as the former interactive /extra-usage command (rate-limit menu, settings). */
export function isExtraUsageInteractiveAvailable(): boolean {
  return (
    isExtraUsageProvisioningAllowed() && !getIsNonInteractiveSession()
  )
}
