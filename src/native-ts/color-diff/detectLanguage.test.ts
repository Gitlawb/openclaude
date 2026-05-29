import { describe, expect, test } from 'bun:test'
import { __test } from './index.js'

const { detectLanguage } = __test

// Regression for #1430 — a file whose basename or stem collides with an
// Object.prototype member used to resolve the inherited function from the
// plain-object FILENAME_LANGS lookup, then crash highlight.js#getLanguage()
// with "(name || '').toLowerCase is not a function" while rendering the diff.
describe('detectLanguage prototype-key safety (#1430)', () => {
  test('does not crash and falls back to the extension for constructor.css', () => {
    expect(detectLanguage('constructor.css', null)).toBe('css')
  })

  test.each([
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    '__proto__',
  ])('basename %p resolves to a language or null, never a function', name => {
    const lang = detectLanguage(name, null)
    expect(lang === null || typeof lang === 'string').toBe(true)
  })

  test('still detects known filename-based languages', () => {
    expect(detectLanguage('Dockerfile', null)).toBe('dockerfile')
    expect(detectLanguage('path/to/Makefile', null)).toBe('makefile')
    expect(detectLanguage('CMakeLists.txt', null)).toBe('cmake')
  })

  test('still detects by extension', () => {
    expect(detectLanguage('foo/bar.ts', null)).toBe('ts')
    expect(detectLanguage('script.py', null)).toBe('py')
  })
})
