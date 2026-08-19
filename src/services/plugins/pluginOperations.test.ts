import { expect, test } from 'bun:test'
import { shouldRemoveFailedPluginFromSettings } from './pluginOperations.js'

test('failed-plugin recovery only falls back for an unregistered installation', () => {
  expect(
    shouldRemoveFailedPluginFromSettings({
      success: false,
      message: 'not installed',
      failureKind: 'not-installed',
    }),
  ).toBe(true)
  expect(
    shouldRemoveFailedPluginFromSettings({
      success: false,
      message: 'cleanup failed',
      failureKind: 'cleanup',
    }),
  ).toBe(false)
  expect(
    shouldRemoveFailedPluginFromSettings({
      success: false,
      message: 'settings write failed',
      failureKind: 'settings-write',
    }),
  ).toBe(false)
})
