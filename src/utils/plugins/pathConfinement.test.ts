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

const symlinkTest = process.platform === 'win32' ? test.skip : test

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

test('path confinement rejects relative and absolute escaping paths', () => {
  const root = mkdtempSync(
    join(tmpdir(), 'openclaude-path-confinement-escape-'),
  )
  const base = join(root, 'base')

  try {
    mkdirSync(base)
    for (const path of ['../escape', join(root, 'absolute-escape')]) {
      expect(() => resolvePathWithinBase(base, path)).toThrow(
        'Path traversal detected',
      )
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('path confinement rejects sibling-prefix paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaude-path-confinement-peer-'))
  try {
    expect(() =>
      resolvePathWithinBase(
        join(root, 'openclaude-cache'),
        '../openclaude-cache-peer',
      ),
    ).toThrow('Path traversal detected')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('path confinement accepts case-only base variants on case-insensitive filesystems', () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaude-path-confinement-case-'))
  const base = join(root, 'CanonicalBase')

  try {
    mkdirSync(base)
    expect(
      resolvePathWithinBase(base, '../CANONICALBASE/nested', {
        caseInsensitive: true,
      }),
    ).toBe(join(root, 'CANONICALBASE', 'nested'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('strict path confinement rejects the base directory itself', () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaude-path-confinement-base-'))
  try {
    expect(() =>
      resolvePathWithinBase(root, '.', { allowBase: false }),
    ).toThrow('Path traversal detected')
    expect(() =>
      validatePathWithinBase(root, root, { allowBase: false }),
    ).toThrow('Path traversal detected')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

symlinkTest(
  'path confinement rejects an existing symlink target outside the base',
  () => {
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
  },
)
