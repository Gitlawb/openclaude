import { expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  resolvePathWithinBase,
  validatePathWithinBase,
} from './pathConfinement.js'

test('path confinement accepts nested paths within the base', () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaude-path-confinement-valid-'))
  const base = join(root, 'base')
  const nested = join(base, 'nested', 'cache')

  try {
    mkdirSync(nested, { recursive: true })
    expect(validatePathWithinBase(base, 'nested/cache')).toBe(
      realpathSync(nested),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test.each(['../escape', '/tmp/escape'])(
  'path confinement rejects escaping path %s',
  path => {
    expect(() => resolvePathWithinBase('/tmp/openclaude-path-base', path)).toThrow(
      'Path traversal detected',
    )
  },
)

test('path confinement rejects sibling-prefix paths', () => {
  expect(() =>
    resolvePathWithinBase('/tmp/openclaude-cache', '../openclaude-cache-peer'),
  ).toThrow('Path traversal detected')
})

test('path confinement rejects an existing symlink target outside the base', () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaude-path-confinement-'))
  const base = join(root, 'base')
  const outside = join(root, 'outside')

  try {
    mkdirSync(base)
    mkdirSync(outside)
    writeFileSync(join(outside, 'cache'), 'outside', 'utf8')
    symlinkSync(join(outside, 'cache'), join(base, 'cache'))
    expect(() => validatePathWithinBase(base, 'cache')).toThrow(
      'Path traversal detected',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
