import assert from 'node:assert/strict'
import test from 'node:test'

import { getDistImportSpecifier } from './import-specifier.mjs'

test('builds a file URL import specifier for dist/cli.mjs', () => {
  const specifier = getDistImportSpecifier('C:\\repo\\bin')

  assert.equal(
    specifier,
    'file:///C:/repo/dist/cli.mjs',
  )
})
