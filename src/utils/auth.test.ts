import { expect, mock, test } from 'bun:test'
import * as originalSettings from './settings/settings.js'

async function importAuthFresh() {
  return await import(`./auth.js?ts=${Date.now()}-${Math.random()}`)
}

test('isClaudeAISubscriber returns true if subscriptionType is pro in settings', async () => {
  mock.module('./settings/settings.js', () => ({
    ...originalSettings,
    getSettings_DEPRECATED: () => ({
      subscriptionType: 'pro',
    }),
  }))

  const { isClaudeAISubscriber, getSubscriptionType } = await importAuthFresh()
  expect(isClaudeAISubscriber()).toBe(true)
  expect(getSubscriptionType()).toBe('pro')
})

test('isClaudeAISubscriber returns false if subscriptionType is free in settings', async () => {
  mock.module('./settings/settings.js', () => ({
    ...originalSettings,
    getSettings_DEPRECATED: () => ({
      subscriptionType: 'free',
    }),
  }))

  const { isClaudeAISubscriber, getSubscriptionType } = await importAuthFresh()
  expect(isClaudeAISubscriber()).toBe(false)
  expect(getSubscriptionType()).toBe('free')
})
