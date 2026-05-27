import { expect, test } from 'bun:test'

import { isTextOnlyOpenAICompatProvider } from './providerConfig.js'

test('isTextOnlyOpenAICompatProvider: matches DeepSeek hosts', () => {
  expect(isTextOnlyOpenAICompatProvider('https://api.deepseek.com/v1')).toBe(true)
  expect(isTextOnlyOpenAICompatProvider('https://api.deepseek.com')).toBe(true)
  expect(isTextOnlyOpenAICompatProvider('https://api.deepseek.com/chat/completions')).toBe(true)
})

test('isTextOnlyOpenAICompatProvider: matches DeepSeek subdomains', () => {
  // The suffix match permits regional/tenant DNS like `eu.api.deepseek.com`
  // without requiring an exact-host enumeration. Only protect the apex domain
  // so unrelated providers that happen to embed `deepseek` in a path don't
  // get a false positive (see baseUrl-with-deepseek-path test below).
  expect(isTextOnlyOpenAICompatProvider('https://eu.api.deepseek.com/v1')).toBe(true)
})

test('isTextOnlyOpenAICompatProvider: does NOT match multimodal providers', () => {
  expect(isTextOnlyOpenAICompatProvider('https://api.openai.com/v1')).toBe(false)
  expect(isTextOnlyOpenAICompatProvider('https://api.anthropic.com')).toBe(false)
  expect(isTextOnlyOpenAICompatProvider('http://localhost:11434/v1')).toBe(false)
  expect(isTextOnlyOpenAICompatProvider('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(false)
})

test('isTextOnlyOpenAICompatProvider: does NOT match URLs that merely mention the brand in a path', () => {
  // Defensive: a proxy whose path happens to contain `deepseek` (model-routing
  // gateways often do) is not necessarily text-only. We only suffix-match the
  // hostname, never the path.
  expect(
    isTextOnlyOpenAICompatProvider('https://api.openrouter.ai/v1/deepseek/chat'),
  ).toBe(false)
})

test('isTextOnlyOpenAICompatProvider: handles invalid / missing input safely', () => {
  expect(isTextOnlyOpenAICompatProvider(undefined)).toBe(false)
  expect(isTextOnlyOpenAICompatProvider('')).toBe(false)
  expect(isTextOnlyOpenAICompatProvider('not a url')).toBe(false)
})
