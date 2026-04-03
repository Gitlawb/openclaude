import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'

import { getDistImportSpecifier } from './import-specifier.mjs'

test('builds a file URL import specifier for dist/cli.mjs', () => {
  // Use dynamic path based on current platform
  const binDir = path.join(__dirname)
  const specifier = getDistImportSpecifier(binDir)

  // Verify the output is a valid file URL
  assert.ok(specifier.startsWith('file://'), 'should be a file URL')
  assert.ok(specifier.endsWith('/dist/cli.mjs'), 'should end with dist/cli.mjs')
})
