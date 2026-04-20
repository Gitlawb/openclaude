import { describe, test, expect } from 'bun:test'
import path from 'path'
import fs from 'fs'
import os from 'os'

/**
 * Tests for the star re-export scanner regex patterns and file resolution
 * used by scanSdkStubImports() in scripts/build.ts.
 *
 * Validates:
 * 1. The `export * from '...'` regex captures specifiers correctly
 * 2. Named export extraction patterns work for various declaration types
 * 3. The `.js` -> `.ts`/`.tsx` candidate generation is correct (no double-replace bug)
 * 4. `fileDir` (pathMod.dirname) is derived correctly from the file path
 */

// --- Regex patterns under test (mirrored from scripts/build.ts) ---

const STAR_REEXPORT_RE = /export\s+\*\s+from\s+['"](.*?)['"]/g
const NAMED_EXPORT_RE = /export\s+(?:const|let|var|function|class|type|interface)\s+(\w+)/g
const NAMED_EXPORT_BRACES_RE = /export\s+\{([^}]*)\}/g

// --- Candidate generation logic (mirrors the fixed version) ---

function generateCandidates(reexportPath: string): string[] {
  const reexportBase = reexportPath.replace(/\.js$/, '')
  return [
    `${reexportBase}.ts`,
    `${reexportBase}.tsx`,
    reexportPath,
    `${reexportPath}.ts`,
    `${reexportPath}.tsx`,
  ]
}

describe('Star re-export scanner: regex patterns', () => {
  test('export * from captures relative specifier', () => {
    const code = `export * from './components/ink'`
    const matches = [...code.matchAll(STAR_REEXPORT_RE)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('./components/ink')
  })

  test('export * from captures src/ specifier', () => {
    const code = `export * from 'src/state/store'`
    const matches = [...code.matchAll(STAR_REEXPORT_RE)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('src/state/store')
  })

  test('export * from captures deep relative path', () => {
    const code = `export * from '../../context/session'`
    const matches = [...code.matchAll(STAR_REEXPORT_RE)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('../../context/session')
  })

  test('export * from with double quotes', () => {
    const code = `export * from "../commands/cli"`
    const matches = [...code.matchAll(STAR_REEXPORT_RE)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('../commands/cli')
  })

  test('export * from ignores non-star exports', () => {
    const code = `export { foo, bar } from './utils'\nexport * from './reexport'\nexport const x = 1`
    const matches = [...code.matchAll(STAR_REEXPORT_RE)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('./reexport')
  })

  test('export * from does not match commented-out lines', () => {
    // The scanner strips comments before matching, but verify the regex
    // doesn't match in commented contexts when comments are not stripped
    const code = `// export * from './should-not-match'\nexport * from './should-match'`
    const matches = [...code.matchAll(STAR_REEXPORT_RE)]
    // The regex will match both lines since it doesn't account for comments
    // This is expected: the scanner strips comments before applying regexes
    expect(matches.length).toBe(2)
    expect(matches[1][1]).toBe('./should-match')
  })

  test('multiple star re-exports are all captured', () => {
    const code = `export * from './a'\nexport * from './b'\nexport * from './c'`
    const matches = [...code.matchAll(STAR_REEXPORT_RE)]
    expect(matches.length).toBe(3)
    expect(matches.map(m => m[1])).toEqual(['./a', './b', './c'])
  })
})

describe('Star re-export scanner: named export extraction', () => {
  test('extracts const exports', () => {
    const code = `export const myConst = 42\nexport const another = 'hello'`
    const matches = [...code.matchAll(NAMED_EXPORT_RE)]
    expect(matches.map(m => m[1])).toEqual(['myConst', 'another'])
  })

  test('extracts function exports', () => {
    const code = `export function doSomething() {}\nexport function helper() {}`
    const matches = [...code.matchAll(NAMED_EXPORT_RE)]
    expect(matches.map(m => m[1])).toEqual(['doSomething', 'helper'])
  })

  test('extracts class exports', () => {
    const code = `export class MyClass {}\nexport class AnotherClass extends MyClass {}`
    const matches = [...code.matchAll(NAMED_EXPORT_RE)]
    expect(matches.map(m => m[1])).toEqual(['MyClass', 'AnotherClass'])
  })

  test('extracts type exports', () => {
    const code = `export type MyType = string\nexport interface MyInterface { x: number }`
    const matches = [...code.matchAll(NAMED_EXPORT_RE)]
    expect(matches.map(m => m[1])).toEqual(['MyType', 'MyInterface'])
  })

  test('extracts let and var exports', () => {
    const code = `export let myVar = 1\nexport var legacyVar = 2`
    const matches = [...code.matchAll(NAMED_EXPORT_RE)]
    expect(matches.map(m => m[1])).toEqual(['myVar', 'legacyVar'])
  })

  test('extracts named export braces', () => {
    const code = `export { foo, bar, baz }`
    const matches = [...code.matchAll(NAMED_EXPORT_BRACES_RE)]
    expect(matches.length).toBe(1)
    const names = matches[0][1].split(',').map(s => s.trim()).filter(Boolean)
    expect(names).toEqual(['foo', 'bar', 'baz'])
  })

  test('extracts aliased named exports in braces', () => {
    const code = `export { foo as bar, baz as qux }`
    const matches = [...code.matchAll(NAMED_EXPORT_BRACES_RE)]
    expect(matches.length).toBe(1)
    // The scanner registers the raw string; the register() function handles aliases
    expect(matches[0][1]).toBe(' foo as bar, baz as qux ')
  })

  test('does not extract non-exported declarations', () => {
    const code = `const x = 1\nfunction foo() {}\nclass Bar {}\nexport const visible = true`
    const matches = [...code.matchAll(NAMED_EXPORT_RE)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('visible')
  })
})

describe('Star re-export scanner: candidate file resolution (double-replace fix)', () => {
  test('.js extension is replaced with .ts and .tsx candidates', () => {
    const candidates = generateCandidates('/src/utils/helper.js')
    expect(candidates[0]).toBe('/src/utils/helper.ts')
    expect(candidates[1]).toBe('/src/utils/helper.tsx')
  })

  test('no double-replace: .js is stripped once, then .ts/.tsx are added', () => {
    const candidates = generateCandidates('/src/components/ink.js')
    // Before the fix, the double .replace(/\.js$/) produced wrong results:
    // .replace(/\.js$/, '.ts').replace(/\.js$/, '.tsx') -> '/src/components/ink.ts'
    // (second .replace finds no .js, so result stays '.ts')
    // After fix: base is '/src/components/ink', candidates are ink.ts and ink.tsx
    expect(candidates[0]).toBe('/src/components/ink.ts')
    expect(candidates[1]).toBe('/src/components/ink.tsx')
  })

  test('original path is included as a fallback candidate', () => {
    const candidates = generateCandidates('/src/state/store.js')
    expect(candidates[2]).toBe('/src/state/store.js')
  })

  test('.ts and .tsx are appended to original path as additional candidates', () => {
    const candidates = generateCandidates('/src/context/session.js')
    expect(candidates[3]).toBe('/src/context/session.js.ts')
    expect(candidates[4]).toBe('/src/context/session.js.tsx')
  })

  test('path without .js extension generates candidates without double-extension', () => {
    const candidates = generateCandidates('/src/utils/helper')
    // reexportBase stays '/src/utils/helper' since no .js to strip
    expect(candidates[0]).toBe('/src/utils/helper.ts')
    expect(candidates[1]).toBe('/src/utils/helper.tsx')
    expect(candidates[2]).toBe('/src/utils/helper')
    expect(candidates[3]).toBe('/src/utils/helper.ts')
    expect(candidates[4]).toBe('/src/utils/helper.tsx')
  })
})

describe('Star re-export scanner: fileDir derivation', () => {
  test('pathMod.dirname extracts directory from file path', () => {
    const full = '/project/src/components/ink/index.ts'
    const fileDir = path.dirname(full)
    expect(fileDir).toBe('/project/src/components/ink')
  })

  test('pathMod.dirname works for nested files', () => {
    const full = '/project/src/state/store.ts'
    const fileDir = path.dirname(full)
    expect(fileDir).toBe('/project/src/state')
  })

  test('pathMod.resolve with fileDir and relative specifier produces correct path', () => {
    const full = '/project/src/components/ink/index.ts'
    const fileDir = path.dirname(full)
    const specifier = './helper'
    const resolved = path.resolve(fileDir, specifier)
    expect(resolved.endsWith(path.join('src', 'components', 'ink', 'helper'))).toBe(true)
  })

  test('pathMod.resolve with fileDir and parent-relative specifier', () => {
    const full = '/project/src/components/ink/index.ts'
    const fileDir = path.dirname(full)
    const specifier = '../shared/utils'
    const resolved = path.resolve(fileDir, specifier)
    expect(resolved.endsWith(path.join('src', 'components', 'shared', 'utils'))).toBe(true)
  })
})

describe('Star re-export scanner: end-to-end candidate resolution', () => {
  test('resolves re-exported module candidates from file path and specifier', () => {
    const full = '/project/src/commands/index.ts'
    const fileDir = path.dirname(full)
    const specifier = './cli'
    const reexportPath = path.resolve(fileDir, specifier)
    const candidates = generateCandidates(reexportPath)

    expect(candidates[0].endsWith(path.join('src', 'commands', 'cli.ts'))).toBe(true)
    expect(candidates[1].endsWith(path.join('src', 'commands', 'cli.tsx'))).toBe(true)
    expect(candidates.some(c => c.endsWith(path.join('src', 'commands', 'cli')))).toBe(true)
  })

  test('resolves .js specifier to .ts/.tsx candidates', () => {
    const full = '/project/src/commands/index.ts'
    const fileDir = path.dirname(full)
    const specifier = './cli.js'
    const reexportPath = path.resolve(fileDir, specifier)
    const candidates = generateCandidates(reexportPath)

    expect(candidates[0].endsWith(path.join('src', 'commands', 'cli.ts'))).toBe(true)
    expect(candidates[1].endsWith(path.join('src', 'commands', 'cli.tsx'))).toBe(true)
  })
})
