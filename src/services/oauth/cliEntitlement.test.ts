import { expect, test } from 'bun:test'

import type { SubscriptionResponse } from '../api/verbooSubscriptions.js'
import { buildCLIEntitlementFromSubscriptions } from './cliEntitlement.js'

const now = Date.parse('2026-08-06T12:00:00.000Z')

function subscription(
  status: string,
  currentPeriodEnd?: string,
  source?: SubscriptionResponse['source'],
): SubscriptionResponse {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    groupId: '00000000-0000-4000-8000-000000000002',
    status,
    currentPeriodEnd,
    source,
    cancelAtPeriodEnd: false,
  }
}

test('derives CLI access from the existing subscriptions response', () => {
  expect(
    buildCLIEntitlementFromSubscriptions(
      [subscription('active', '2026-08-07T12:00:00.000Z')],
      now,
    ),
  ).toMatchObject({
    allowed: true,
    reason: 'active',
    validUntil: '2026-08-07T12:00:00.000Z',
  })

  expect(
    buildCLIEntitlementFromSubscriptions(
      [subscription('trialing', '2026-08-07T12:00:00.000Z')],
      now,
    ),
  ).toMatchObject({ allowed: true, reason: 'trialing' })

  expect(
    buildCLIEntitlementFromSubscriptions([subscription('past_due')], now),
  ).toMatchObject({ allowed: false, reason: 'past_due' })

  expect(buildCLIEntitlementFromSubscriptions([], now)).toMatchObject({
    allowed: false,
    reason: 'subscription_required',
  })
})

test('allows a CLI session backed only by an active managed seat', () => {
  expect(
    buildCLIEntitlementFromSubscriptions(
      [subscription('active', undefined, 'managed_seat')],
      now,
    ),
  ).toMatchObject({ allowed: true, reason: 'active' })
})


test('free token access has no day expiry and blocks at exhaustion or pending usage', () => {
  const sub = { ...subscription('trialing', undefined, 'free_tokens'), freeTokens: {
    eligible: false, state: 'active' as const, tokenLimit: 100, tokensUsed: 20, tokensRemaining: 80,
    accountingPending: false, activationUrl: 'https://code.verboo.ai/free-tokens',
  } }
  expect(buildCLIEntitlementFromSubscriptions([sub], now)).toMatchObject({ allowed: true, reason: 'trialing' })
  expect(buildCLIEntitlementFromSubscriptions([{ ...sub, freeTokens: { ...sub.freeTokens, tokensUsed: 105, tokensRemaining: 0, state: 'exhausted' } }], now)).toMatchObject({ allowed: false, reason: 'free_tokens_exhausted' })
  expect(buildCLIEntitlementFromSubscriptions([{ ...sub, freeTokens: { ...sub.freeTokens, accountingPending: true } }], now)).toMatchObject({ allowed: false, reason: 'free_tokens_accounting_pending' })
  expect(buildCLIEntitlementFromSubscriptions([{ ...sub, freeTokens: { ...sub.freeTokens, state: 'activating' } }], now)).toMatchObject({ allowed: false, reason: 'free_tokens_activation_pending' })
  expect(buildCLIEntitlementFromSubscriptions([{ ...sub, status: 'canceled', freeTokens: { ...sub.freeTokens, state: 'exhausted', tokensRemaining: 0 } }, subscription('active')], now)).toMatchObject({ allowed: true, reason: 'active' })
})
