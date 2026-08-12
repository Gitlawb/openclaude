import { expect, mock, test } from 'bun:test'

import {
  deletePluginOptions,
  loadPluginOptions,
} from './pluginOptionsStorage.js'

test('plugin option cleanup keeps secure secrets when the plaintext scrub is rejected', () => {
  const read = mock(() => ({
    pluginSecrets: { 'demo@market': { token: 'secret' } },
  }))
  const update = mock(() => ({ success: true }))

  const result = deletePluginOptions('demo@market', {
    updateUserSettings: mock(() => ({
      error: new Error('settings lock busy'),
      written: false,
    })),
    secureStorage: { read, update } as never,
  })

  expect(result).toEqual({ success: false, error: 'settings lock busy' })
  expect(read).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
})

test('plugin option cleanup reports secure-storage deletion failure', () => {
  const read = mock(() => ({
    pluginSecrets: { 'demo@market': { token: 'secret' } },
  }))
  const update = mock(() => ({ success: false }))

  const result = deletePluginOptions('demo@market', {
    updateUserSettings: mock((_source, updater) => {
      updater({})
      return { error: null, unchanged: true, written: false }
    }),
    secureStorage: { read, update } as never,
  })

  expect(result).toEqual({
    success: false,
    error:
      'Failed to clear plugin secrets for demo@market from secure storage',
  })
  expect(update).toHaveBeenCalledTimes(1)
})

test('plugin option cleanup invalidates plaintext cache before secure cleanup fails', () => {
  loadPluginOptions.cache?.set?.('demo@market', { stale: 'value' })

  const result = deletePluginOptions('demo@market', {
    updateUserSettings: mock((_source, updater) => {
      updater({
        pluginConfigs: {
          'demo@market': { options: { stale: 'value' } },
        },
      })
      return { error: null, written: true }
    }),
    secureStorage: {
      read: mock(() => ({
        pluginSecrets: { 'demo@market': { token: 'secret' } },
      })),
      update: mock(() => ({ success: false })),
    } as never,
  })

  expect(result.success).toBe(false)
  expect(loadPluginOptions.cache?.has?.('demo@market')).toBe(false)
})
