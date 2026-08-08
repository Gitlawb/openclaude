import { describe, expect, test } from 'bun:test'

import { checkReadOnlyConstraints } from './readOnlyValidation.js'

const isReadOnly = (command: string): boolean =>
  checkReadOnlyConstraints({ command }, false).behavior === 'allow'

// Package-manager / compiler version queries are read-only. node/python were
// already covered; npm/bun/tsc were not, so they fell through to a permission
// prompt. They must be allowed in exact-anchored form only — never with a
// trailing argument, which could smuggle a script-running flag past the check.
describe('read-only version queries (npm/bun/tsc)', () => {
  test.each([
    'npm --version',
    'npm -v',
    'bun --version',
    'bun -v',
    'tsc --version',
    'tsc -v',
    // Pre-existing coverage — guards against regressions in the same block.
    'node --version',
    'node -v',
    'python --version',
  ])('allows %j', cmd => {
    expect(isReadOnly(cmd)).toBe(true)
  })

  test.each([
    'npm install',
    'npm i left-pad',
    'npm run build',
    'npm --version --run build', // suffix must not be permitted
    'npm -v foo',
    'bun add left-pad',
    'tsc -p .',
    'tsc --build',
    'npm', // bare command is not a version query
  ])('does not allow %j', cmd => {
    expect(isReadOnly(cmd)).toBe(false)
  })
})
