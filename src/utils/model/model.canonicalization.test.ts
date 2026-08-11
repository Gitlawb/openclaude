import { expect, test } from 'bun:test'

import { firstPartyNameToCanonical } from './model.js'

test('firstPartyNameToCanonical preserves current Claude model generations', () => {
  expect(firstPartyNameToCanonical('claude-opus-5')).toBe('claude-opus-5')
  expect(firstPartyNameToCanonical('claude-sonnet-5')).toBe('claude-sonnet-5')
  expect(firstPartyNameToCanonical('claude-haiku-4-5')).toBe('claude-haiku-4-5')
  expect(firstPartyNameToCanonical('claude-fable-5')).toBe('claude-fable-5')
})
