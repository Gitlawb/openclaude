import { describe, expect, test } from 'bun:test'
import { __test } from './index.js'

const { detectLanguage } = __test

// A lightweight stand-in for highlight.js#getLanguage so this regression check
// stays isolated: it must not lazy-load and cache the full highlight.js
// registry into the shared Bun test process (per the module comment in
// index.ts). detectLanguage takes the validator as an injectable third
// argument exactly so this coverage can run without loading hljs.
const KNOWN_LANGUAGES = new Set(['css', 'dockerfile', 'makefile', 'cmake', 'ts', 'py'])
const isValidLanguage = (name: string) =>
  KNOWN_LANGUAGES.has(name.toLowerCase())

// Regression for #1430 — a file whose basename or stem collides with an
// Object.prototype member used to resolve the inherited function from the
// plain-object FILENAME_LANGS lookup, then crash highlight.js#getLanguage()
// with "(name || '').toLowerCase is not a function" while rendering the diff.
describe('detectLanguage prototype-key safety (#1430)', () => {
  test('does not crash and falls back to the extension for constructor.css', () => {
    expect(detectLanguage('constructor.css', null, isValidLanguage)).toBe('css')
  })

  test.each([
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    '__proto__',
  ])('basename %p resolves to a language or null, never a function', name => {
    const lang = detectLanguage(name, null, isValidLanguage)
    expect(lang === null || typeof lang === 'string').toBe(true)
  })

  test('still detects known filename-based languages', () => {
    expect(detectLanguage('Dockerfile', null, isValidLanguage)).toBe('dockerfile')
    expect(detectLanguage('path/to/Makefile', null, isValidLanguage)).toBe('makefile')
    expect(detectLanguage('CMakeLists.txt', null, isValidLanguage)).toBe('cmake')
  })

  test('still detects by extension', () => {
    expect(detectLanguage('foo/bar.ts', null, isValidLanguage)).toBe('ts')
    expect(detectLanguage('script.py', null, isValidLanguage)).toBe('py')
  })
})
