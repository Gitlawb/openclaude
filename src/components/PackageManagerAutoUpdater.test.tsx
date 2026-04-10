import { expect, test } from 'bun:test'

import { PackageManagerAutoUpdater } from './PackageManagerAutoUpdater.js'

test('component exports successfully', () => {
  expect(typeof PackageManagerAutoUpdater).toBe('function')
})
