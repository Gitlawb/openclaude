import { expect, test } from 'bun:test'
import { shouldUseFirstPartyAnthropicAuthForProvider } from './authRouting.js'

const providerOverride = {
  model: 'gpt-4o',
  baseURL: 'https://provider.example/v1',
  apiKey: 'provider-test-key',
}

test('Gemini provider routing does not use first-party Anthropic auth', () => {
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      apiProvider: 'gemini',
      isFirstPartyBaseUrl: true,
    }),
  ).toBe(false)
})

test('providerOverride routing does not use first-party Anthropic auth', () => {
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      providerOverride,
      apiProvider: 'firstParty',
      isFirstPartyBaseUrl: true,
    }),
  ).toBe(false)
})

test('first-party Anthropic routing uses first-party Anthropic auth', () => {
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      apiProvider: 'firstParty',
      isFirstPartyBaseUrl: true,
    }),
  ).toBe(true)
})

test('custom Anthropic base URLs do not use first-party Anthropic auth', () => {
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      apiProvider: 'firstParty',
      isFirstPartyBaseUrl: false,
    }),
  ).toBe(false)
})
