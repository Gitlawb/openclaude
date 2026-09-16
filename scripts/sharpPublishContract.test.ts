import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Regression for Gitlawb/openclaude#2224: since 0.23.0 `sharp` lived only in
 * devDependencies, so `npm install -g @gitlawb/openclaude` never installed it
 * and every image path failed (often swallowed as "No image found in clipboard").
 *
 * Published installs must declare sharp in `dependencies` or
 * `optionalDependencies` — not only in `devDependencies`.
 *
 * Hermetic: reads package.json only. No pack, registry, or native install.
 */
describe('sharp publish contract (#2224)', () => {
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  test('published installs include sharp (not only-in-devDependencies)', () => {
    const shipped =
      pkg.dependencies?.sharp !== undefined ||
      pkg.optionalDependencies?.sharp !== undefined
    expect(shipped).toBe(true)
  })
})
