import { expect, test } from 'bun:test'
import {
  shouldUseCustomAnthropicBearerAuth,
  shouldUseFirstPartyAnthropicAuthForProvider,
} from './authRouting.js'

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

test('custom Anthropic bearer tokens use native custom authentication', () => {
  expect(
    shouldUseCustomAnthropicBearerAuth({
      apiProvider: 'firstParty',
      isFirstPartyBaseUrl: false,
      authToken: 'custom-token',
    }),
  ).toBe(true)
})

test('providerOverride routing does not use custom Anthropic bearer auth', () => {
  expect(
    shouldUseCustomAnthropicBearerAuth({
      providerOverride,
      apiProvider: 'firstParty',
      isFirstPartyBaseUrl: false,
      authToken: 'custom-token',
    }),
  ).toBe(false)
})

test('custom Anthropic bearer tokens are never forwarded to shim routes', () => {
  expect(
    shouldUseCustomAnthropicBearerAuth({
      apiProvider: 'gemini',
      isFirstPartyBaseUrl: false,
      authToken: 'custom-token',
    }),
  ).toBe(false)
})
