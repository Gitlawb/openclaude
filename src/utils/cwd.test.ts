import { describe, expect, test } from 'bun:test'
import { getCwd, runWithCwdOverride } from './cwd.js'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('runWithCwdOverride', () => {
  test('restores the outer cwd override after a nested synchronous override', () => {
    runWithCwdOverride('/tmp/outer-cwd', () => {
      expect(getCwd()).toBe('/tmp/outer-cwd')

      const inner = runWithCwdOverride('/tmp/inner-cwd', () => getCwd())
      expect(inner).toBe('/tmp/inner-cwd')
      expect(getCwd()).toBe('/tmp/outer-cwd')
    })
  })

  test('keeps overlapping async cwd override windows isolated', async () => {
    const first = runWithCwdOverride('/tmp/first-cwd', async () => {
      expect(getCwd()).toBe('/tmp/first-cwd')
      await delay(20)
      expect(getCwd()).toBe('/tmp/first-cwd')
      return getCwd()
    })

    const second = runWithCwdOverride('/tmp/second-cwd', async () => {
      expect(getCwd()).toBe('/tmp/second-cwd')
      await delay(5)
      expect(getCwd()).toBe('/tmp/second-cwd')
      return getCwd()
    })

    await expect(Promise.all([first, second])).resolves.toEqual([
      '/tmp/first-cwd',
      '/tmp/second-cwd',
    ])
  })
})
