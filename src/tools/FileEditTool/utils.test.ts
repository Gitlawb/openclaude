import { describe, expect, test } from 'vitest'
import { findWhitespaceAgnosticMatch } from './utils.js'

describe('findWhitespaceAgnosticMatch', () => {
  test('returns exact match for simple string', () => {
    const fileContent = 'const x = 1;\nconst y = 2;'
    const searchString = 'const x=1;'
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBe('const x = 1;')
  })

  test('handles missing trailing newlines', () => {
    const fileContent = 'function hello() {\n  console.log("world");\n}\n'
    const searchString = 'function hello() {\n  console.log("world");\n}'
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBe('function hello() {\n  console.log("world");\n}')
  })

  test('handles indentation changes', () => {
    const fileContent = 'function hello() {\n    console.log("world");\n}'
    const searchString = 'function hello() {\n  console.log("world");\n}'
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBe('function hello() {\n    console.log("world");\n}')
  })

  test('handles inline space changes', () => {
    const fileContent = 'if ( a === b ) { return c; }'
    const searchString = 'if(a===b){return c;}'
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBe('if ( a === b ) { return c; }')
  })

  test('returns null if no match found', () => {
    const fileContent = 'const a = 1;'
    const searchString = 'const b = 2;'
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBeNull()
  })

  test('returns null if multiple matches found to prevent accidental replacement', () => {
    const fileContent = 'const a = 1;\nconst a = 1;'
    const searchString = 'const a = 1;'
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBeNull()
  })
})
