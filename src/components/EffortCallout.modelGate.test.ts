import { expect, test } from 'bun:test'
import { effortCalloutCoversModel } from './EffortCallout.js'

// Regression for #1769: the default Opus is now 4.8, so the effort callout's
// model gate must cover opus-4-8 (and 4.7) alongside the original 4.6. This
// asserts the pure model predicate directly with explicit canonical model ids —
// no module mocking, no fresh-import, and no bare alias. The bare 'opus' alias
// is intentionally NOT used here: it routes through getDefaultOpusModel(), whose
// result is config/environment-dependent (it resolves the configured default
// Opus, not necessarily 4.8 in a clean CI environment), which is what made the
// earlier assertions flaky on Linux CI. The gate's own coverage logic is a plain
// string check, so explicit ids exercise the regression deterministically.
test('effort callout covers the recent Opus models including 4.8 (#1769)', () => {
  expect(effortCalloutCoversModel('claude-opus-4-8')).toBe(true)
  expect(effortCalloutCoversModel('claude-opus-4-7')).toBe(true)
  expect(effortCalloutCoversModel('claude-opus-4-6')).toBe(true)
  // The [1m] tag and provider-prefixed variants still match the family.
  expect(effortCalloutCoversModel('claude-opus-4-8[1m]')).toBe(true)
  // Models outside the recent-Opus family are not covered.
  expect(effortCalloutCoversModel('claude-sonnet-4-6')).toBe(false)
  expect(effortCalloutCoversModel('gpt-5')).toBe(false)
})

test('effort callout covers Opus 5 on first party but excludes Vertex', () => {
  const originalVertex = process.env.CLAUDE_CODE_USE_VERTEX
  try {
    delete process.env.CLAUDE_CODE_USE_VERTEX
    expect(effortCalloutCoversModel('claude-opus-5')).toBe(true)

    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(effortCalloutCoversModel('claude-opus-5')).toBe(false)
    // Legacy models remain covered on Vertex
    expect(effortCalloutCoversModel('claude-opus-4-8')).toBe(true)
  } finally {
    if (originalVertex !== undefined) {
      process.env.CLAUDE_CODE_USE_VERTEX = originalVertex
    } else {
      delete process.env.CLAUDE_CODE_USE_VERTEX
    }
  }
})

test('effort callout respects reasoning capability context for custom routes and overrides', () => {
  // Custom OpenAI-compatible route named claude-opus-5 with no reasoning metadata is not covered
  expect(effortCalloutCoversModel('claude-opus-5', { apiProvider: 'openai' })).toBe(false)

  // Route with explicit effort capability override supporting medium is covered
  expect(
    effortCalloutCoversModel('claude-opus-5', {
      routeId: 'custom',
      catalogEntries: [
        {
          id: 'claude-opus-5',
          apiName: 'claude-opus-5',
          reasoning: {
            wireFormat: 'reasoning_effort',
            mode: 'levels',
            levels: ['low', 'medium', 'high'],
          },
        },
      ],
    }),
  ).toBe(true)

  // Route with explicit effort capability override lacking medium is not covered
  expect(
    effortCalloutCoversModel('claude-opus-5', {
      routeId: 'custom',
      catalogEntries: [
        {
          id: 'claude-opus-5',
          apiName: 'claude-opus-5',
          reasoning: {
            wireFormat: 'reasoning_effort',
            mode: 'levels',
            levels: ['low', 'high'],
          },
        },
      ],
    }),
  ).toBe(false)
})
