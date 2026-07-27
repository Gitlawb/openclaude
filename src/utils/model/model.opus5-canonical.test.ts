import { expect, test } from 'bun:test'

import { getCanonicalName } from './model.js'

test('canonicalizes Claude Opus 5 model variants', () => {
  expect(getCanonicalName('claude-opus-5')).toBe('claude-opus-5')
  expect(getCanonicalName('claude-opus-5[1m]')).toBe('claude-opus-5')
  expect(getCanonicalName('us.anthropic.claude-opus-5-v1:0')).toBe(
    'claude-opus-5',
  )
})
