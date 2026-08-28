import { afterEach, expect, mock, test } from 'bun:test'

import * as realAuth from '../auth.js'

// Both regressions in this file need a subscriber gate flipped, so auth.js is
// mocked with the gated pattern used elsewhere in this suite: the override is
// inert unless a test sets it, which keeps bun's process-global mock registry
// from changing behavior for any other test file.
let subscriberOverride: { pro?: boolean; max?: boolean } | undefined

mock.module('../auth.js', () => ({
  ...realAuth,
  isProSubscriber: (...args: Parameters<typeof realAuth.isProSubscriber>) =>
    subscriberOverride
      ? !!subscriberOverride.pro
      : realAuth.isProSubscriber(...args),
  isMaxSubscriber: (...args: Parameters<typeof realAuth.isMaxSubscriber>) =>
    subscriberOverride
      ? !!subscriberOverride.max
      : realAuth.isMaxSubscriber(...args),
}))

afterEach(() => {
  subscriberOverride = undefined
})

async function importFresh() {
  const salt = `${Date.now()}-${Math.random()}`
  const [model, effort, callout] = await Promise.all([
    import(`./model.js?ts=${salt}`),
    import(`../effort.js?ts=${salt}`),
    import(`../../components/EffortCallout.js?ts=${salt}`),
  ])
  return { model, effort, callout }
}

// The default subscriber description advertises Opus 5, and modelCost.ts bills
// Opus 5 fast mode at its own $10/$50 tier. Before this change both fast-mode
// branches called getOpus46PricingSuffix(true) and inherited the helper's
// historical `opus48` default, so the picker showed Opus 4.8's fast-mode rate
// on the new default path while cost accounting tracked the Opus 5 rate.
test('the Max fast-mode default description shows the Opus 5 rate', async () => {
  subscriberOverride = { max: true }
  const { model } = await importFresh()

  const description = model.getClaudeAiUserDefaultModelDescription(true)
  expect(description).toContain('Opus 5')
  expect(description).toContain('$10/$50 per Mtok')
})

test('the non-fast default description carries no fast-mode rate', async () => {
  subscriberOverride = { max: true }
  const { model } = await importFresh()

  expect(model.getClaudeAiUserDefaultModelDescription(false)).not.toContain(
    'per Mtok',
  )
})

// The callout announces the medium-effort default. Before this change the
// cohort was duplicated: EffortCallout listed Opus 5 while
// getLegacyDefaultEffortForModel still matched only Opus 4.6-4.8, so Pro users
// on the new default saw copy for a default they never received.
test('the effort callout and the resolved default agree on Opus 5', async () => {
  subscriberOverride = { pro: true }
  const { effort, callout } = await importFresh()

  expect(callout.effortCalloutCoversModel('claude-opus-5')).toBe(true)
  expect(effort.getDefaultEffortForModel('claude-opus-5')).toBe('medium')

  expect(callout.effortCalloutCoversModel('claude-opus-4-8')).toBe(true)
  expect(effort.getDefaultEffortForModel('claude-opus-4-8')).toBe('medium')
})

// The cohort predicate takes an already-resolved id. parseUserSpecifiedModel
// maps retired ids such as claude-opus-4-1 onto the current default Opus, so
// resolving inside the effort resolver would hand them a default they never
// had (src/utils/effort.test.ts pins the same control).
test('a retired Opus that resolves forward to Opus 5 keeps its own default', async () => {
  subscriberOverride = { pro: true }
  const { effort } = await importFresh()

  expect(effort.getDefaultEffortForModel('claude-opus-4-1')).toBeUndefined()
})

test('a Claude 5 near match gets neither the callout nor the medium default', async () => {
  subscriberOverride = { pro: true }
  const { effort, callout } = await importFresh()

  expect(callout.effortCalloutCoversModel('claude-opus-50')).toBe(false)
  expect(effort.getDefaultEffortForModel('claude-opus-50')).toBeUndefined()
})
