import { describe, expect, test } from 'bun:test'

import { firstPartyNameToCanonical } from './model.js'

describe('firstPartyNameToCanonical - Claude 4+', () => {
  test.each([
    ['claude-opus-5', 'claude-opus-5'],
    ['claude-opus-4-8', 'claude-opus-4-8'],
    ['claude-opus-4-7', 'claude-opus-4-7'],
    ['claude-opus-4-6', 'claude-opus-4-6'],
    ['claude-opus-4-5', 'claude-opus-4-5'],
    ['claude-opus-4-1', 'claude-opus-4-1'],
    ['claude-opus-4', 'claude-opus-4'],
    ['claude-sonnet-4-6', 'claude-sonnet-4-6'],
    ['claude-sonnet-4-5', 'claude-sonnet-4-5'],
    ['claude-sonnet-4', 'claude-sonnet-4'],
    ['claude-haiku-4-5', 'claude-haiku-4-5'],
  ])('canonicalizes %s', (model, canonical) => {
    expect(firstPartyNameToCanonical(model)).toBe(canonical)
  })

  test.each([
    ['claude-opus-5[1m]', 'claude-opus-5'],
    ['us.anthropic.claude-opus-5-v1:0', 'claude-opus-5'],
    ['opencode-claude-opus-4-8', 'claude-opus-4-8'],
    ['anthropic/claude-sonnet-4-6', 'claude-sonnet-4-6'],
    ['claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
  ])('canonicalizes provider or suffix variant %s', (model, canonical) => {
    expect(firstPartyNameToCanonical(model)).toBe(canonical)
  })

  test.each([
    ['claude-opus-50', 'claude-opus-5'],
    ['claude-opus-5x', 'claude-opus-5'],
    ['claude-opus-4-80', 'claude-opus-4-8'],
    ['claude-opus-4-8x', 'claude-opus-4-8'],
    ['claude-sonnet-4-60', 'claude-sonnet-4-6'],
    ['claude-haiku-4-50', 'claude-haiku-4-5'],
  ])('does not canonicalize near-match %s as %s', (model, canonical) => {
    expect(firstPartyNameToCanonical(model)).not.toBe(canonical)
  })
})
