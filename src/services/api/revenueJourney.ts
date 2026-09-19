import { randomUUID } from 'node:crypto'
import { logForDebugging } from '../../utils/debug.js'

// CLI diagnostics contain only finite labels and internal random references.
// The same IDs are sent to the API's authenticated Revenue Journey observer.
const codes = new Set(['purchase_attempt_failed', 'purchase_attempt_expired', 'purchase_attempt_review', 'checkout_intent_required', 'checkout_in_progress', 'checkout_request_conflict', 'new_acquisition_disabled', 'group_full', 'already_subscribed', 'manual_access_active', 'payment_past_due', 'invalid_request', 'rate_limited', 'network_error', 'request_timeout', 'request_cancelled', 'contract_error'])
const journeys = new Map<string, string>()
export function commercialOperation(stage: 'checkout_request' | 'trial_activation' | 'email_verification' | 'catalog' | 'payment_return', operationId: string = randomUUID()) {
  let journeyId = journeys.get(operationId)
  if (!journeyId) {journeyId = randomUUID();journeys.set(operationId, journeyId)}
  const write = (outcome: 'started' | 'succeeded' | 'failed', error?: unknown) => {
    try {
      const e = error as {code?: string; kind?: string; status?: number} | undefined
      const code = e?.code && codes.has(e.code) ? e.code : e?.kind === 'contract' ? 'contract_error' : error ? 'unknown' : ''
      logForDebugging(JSON.stringify({event_domain: 'revenue_journey',schema_version: 2,journey_id: journeyId,operation_id: operationId,stage,outcome,error_code: code,...(e?.status ? {http_status: e.status} : {})}))
    } catch { /* Diagnostics cannot block a purchase. */ }
  }
  write('started')
  return {headers: {'X-Verboo-Journey-Id': journeyId, 'X-Verboo-Operation-Id': operationId}, complete: () => write('succeeded'), fail: (error: unknown) => write('failed', error)}
}
