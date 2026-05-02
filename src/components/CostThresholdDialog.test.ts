import { expect, test } from 'bun:test'

import { getCostThresholdProviderLabelForProvider } from './CostThresholdProviderLabel.js'

test('getCostThresholdProviderLabel uses the active provider category for first-party sessions', () => {
  expect(getCostThresholdProviderLabelForProvider('firstParty')).toBe(
    'Anthropic API',
  )
})

test('getCostThresholdProviderLabel keeps descriptor-era labels for mapped providers', () => {
  expect(getCostThresholdProviderLabelForProvider('gemini')).toBe('Gemini API')
  expect(getCostThresholdProviderLabelForProvider('bedrock')).toBe(
    'AWS Bedrock',
  )
})

test('getCostThresholdProviderLabel falls back safely for unmapped provider categories', () => {
  expect(getCostThresholdProviderLabelForProvider('codex')).toBe('API')
})
