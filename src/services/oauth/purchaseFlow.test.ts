import { expect, test } from 'bun:test'

import type { MarketplaceGroup } from '../api/verbooMarketplace.js'
import type { SubscriptionResponse } from '../api/verbooSubscriptions.js'
import {
  filterCliPurchasablePlans,
  getPlanColumnCount,
  getPlanDetailOptions,
  getStripeTrialConversionUrl,
  movePlanFocus,
} from './purchaseFlow.js'
import { isValidCPF, onlyDigits } from './purchaseValidation.js'

const GROUP_ID = '11111111-1111-4111-8111-111111111111'

function plan(overrides: Partial<MarketplaceGroup> = {}): MarketplaceGroup {
  return {
    id: GROUP_ID,
    name: 'Plano CLI',
    slug: 'plano-cli',
    priceCents: 1_000,
    currency: 'brl',
    billingInterval: 'month',
    instances: [{ models: [{ modelName: 'modelo' }] }],
    trialPaymentMethodRequired: false,
    trialEligible: false,
    paymentProvider: 'stripe',
    apiOnly: false,
    isMember: false,
    isOnWaitlist: false,
    waitlistEnabled: false,
    waitlistSubscribersOnly: false,
    ...overrides,
  }
}

function subscription(
  overrides: Partial<SubscriptionResponse> = {},
): SubscriptionResponse {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    groupId: GROUP_ID,
    status: 'active',
    cancelAtPeriodEnd: false,
    ...overrides,
  }
}

test('validates CPF with its check digits', () => {
  expect(isValidCPF('529.982.247-25')).toBe(true)
  expect(isValidCPF('529.982.247-24')).toBe(false)
  expect(isValidCPF('111.111.111-11')).toBe(false)
})

test('removes display formatting before submitting payer data', () => {
  expect(onlyDigits('(11) 99999-9999')).toBe('11999999999')
  expect(onlyDigits('529.982.247-25')).toBe('52998224725')
})

test('filters API-only, waitlist, model-less, and already-paid plans', () => {
  expect(filterCliPurchasablePlans([plan({ apiOnly: true })], [])).toEqual([])
  expect(
    filterCliPurchasablePlans([plan({ waitlistEnabled: true })], []),
  ).toEqual([])
  expect(filterCliPurchasablePlans([plan({ instances: [] })], [])).toEqual([])
  expect(
    filterCliPurchasablePlans([plan({ isMember: true })], [subscription()]),
  ).toEqual([])
})

test('keeps a previously tested plan available for paid purchase', () => {
  const usedTrial = plan({ trialDays: 7, trialEligible: false })
  expect(filterCliPurchasablePlans([usedTrial], [])).toEqual([usedTrial])
  expect(getPlanDetailOptions(usedTrial)).toEqual([
    { label: 'Assinar agora', value: 'buy' },
    { label: 'Voltar', value: 'back' },
  ])
})

test('offers both free trial and immediate paid purchase when eligible', () => {
  const eligible = plan({ trialDays: 7, trialEligible: true })
  expect(getPlanDetailOptions(eligible).map((option) => option.value)).toEqual([
    'trial',
    'buy',
    'back',
  ])
})

test('never advertises a trial for an annual offer', () => {
  const annual = plan({
    billingInterval: 'year',
    trialDays: 7,
    trialEligible: true,
  })
  expect(getPlanDetailOptions(annual).map((option) => option.value)).toEqual([
    'buy',
    'back',
  ])
})

test('keeps an active local trial available for paid conversion even when full', () => {
  const trialPlan = plan({
    isMember: true,
    subscriberLimit: 10,
    memberCount: 10,
  })
  expect(
    filterCliPurchasablePlans(
      [trialPlan],
      [subscription({ source: 'stripe_trial', status: 'trialing' })],
    ),
  ).toEqual([trialPlan])
})

test('routes a Stripe trial to the dedicated full-price conversion journey', () => {
  expect(
    getStripeTrialConversionUrl(
      '22222222-2222-4222-8222-222222222222',
      'year',
    ),
  ).toBe(
    'https://code.verboo.ai/pt/settings/billing?subscription=22222222-2222-4222-8222-222222222222&action=convert&billingInterval=year',
  )
})

test('keeps legacy local trials available for paid conversion', () => {
  const trialPlan = plan({ isMember: true })
  expect(
    filterCliPurchasablePlans(
      [trialPlan],
      [subscription({ source: 'trial', status: 'trialing' })],
    ),
  ).toEqual([trialPlan])
})

test('moves grid focus without crossing row edges or partial rows', () => {
  expect(movePlanFocus(0, 'left', 5, 3)).toBe(0)
  expect(movePlanFocus(2, 'right', 5, 3)).toBe(2)
  expect(movePlanFocus(1, 'down', 5, 3)).toBe(4)
  expect(movePlanFocus(2, 'down', 5, 3)).toBe(2)
  expect(movePlanFocus(4, 'up', 5, 3)).toBe(1)
  expect(getPlanColumnCount(60)).toBe(1)
  expect(getPlanColumnCount(90)).toBe(2)
  expect(getPlanColumnCount(140)).toBe(3)
})


test('offers free tokens with a saved card even for annual billing, without day trial copy', () => {
  const eligible = plan({ freeTokens: 100000, freeTokensEligible: true, trialDays: null, billingInterval: 'year' })
  expect(getPlanDetailOptions(eligible).map(option => option.value)).toEqual(['free-tokens', 'back'])
  expect(getPlanDetailOptions(eligible)[0]!.label).toContain('sem cobrança')
  expect(getPlanDetailOptions({ ...eligible, freeTokensEligible: false }).map(option => option.value)).toEqual(['buy', 'back'])
})
