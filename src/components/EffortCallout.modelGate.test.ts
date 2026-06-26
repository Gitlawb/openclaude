import { expect, test } from 'bun:test'
import { effortCalloutCoversModel } from './EffortCallout.js'

// Regression for #1769: the default Opus is now 4.8, so the effort callout's
// model gate must cover opus-4-8 (and 4.7) alongside the original 4.6. This
// asserts the pure model predicate directly — no module mocking or fresh-import
// is involved, so it is deterministic regardless of suite ordering. The earlier
// behavioral test mocked auth/config/effort and relied on the consumer picking
// up those mocks, which was order-dependent and failed only in Linux CI.
test('effort callout covers the current default Opus (now 4.8) (#1769)', () => {
  // The bare 'opus' alias resolves to the default Opus (claude-opus-4-8).
  expect(effortCalloutCoversModel('opus')).toBe(true)
  expect(effortCalloutCoversModel('claude-opus-4-8')).toBe(true)
  expect(effortCalloutCoversModel('claude-opus-4-7')).toBe(true)
  expect(effortCalloutCoversModel('claude-opus-4-6')).toBe(true)
  // Models outside the recent-Opus family are not covered.
  expect(effortCalloutCoversModel('claude-sonnet-4-6')).toBe(false)
  expect(effortCalloutCoversModel('gpt-5')).toBe(false)
})
