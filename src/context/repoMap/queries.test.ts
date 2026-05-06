import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { getBundledQuery } from './queries.js'
import type { SupportedLanguage } from './types.js'

const __dirname = join(fileURLToPath(import.meta.url), '..')

describe('bundled query drift guard', () => {
  test.each<SupportedLanguage>(['typescript', 'javascript', 'python'])(
    '%s: bundled query matches the .scm source file byte-for-byte',
    (language) => {
      const fromFile = readFileSync(
        join(__dirname, 'queries', `${language}-tags.scm`),
        'utf-8',
      )
      const bundled = getBundledQuery(language)
      expect(bundled).not.toBeNull()
      expect(bundled).toBe(fromFile)
    },
  )

  test('returns null for unknown language', () => {
    expect(getBundledQuery('unknown' as SupportedLanguage)).toBeNull()
  })
})
