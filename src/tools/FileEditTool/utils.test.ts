import { describe, expect, test } from 'bun:test'
import { findWhitespaceAgnosticMatch } from './utils.js'

describe('findWhitespaceAgnosticMatch', () => {
  test('returns exact match for simple string', () => {
    const fileContent = 'const x = 1;\nconst y = 2;'
    const searchString = 'const x = 1;'
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

  test('rejects inline space changes to protect tokenization and operators', () => {
    const fileContent = 'if ( a === b ) { return c; }'
    const searchString = 'if(a===b){return c;}'
    // Inline space differences are now strictly rejected to prevent merging/splitting tokens
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBeNull()
  })

  test('prevents operator token collapsing across fuzzy matches', () => {
    const fileContent = 'const z = i++ + j;'
    const searchString = 'const z = i + ++j;'
    // If inline spaces are ignored, both become i+++j, which would be a dangerous match.
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBeNull()
  })

  test('preserves boundary whitespace for single-line indentation differences', () => {
    const fileContent = 'function hello() {\n    foo();\n}'
    const searchString = '  foo();' // Agent thought it was 2 spaces
    // Because the file has 4 spaces and searchString starts with space, 
    // it should expand leftwards and capture the file's leading spaces
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBe('    foo();')
  })

  test('prevents matching across token boundaries', () => {
    // LLM forgot the space between two tokens
    const fileContent = 'const foobar = 1;'
    const searchString = 'const foo bar = 1;'
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBeNull()

    // LLM inserted a space inside a token
    const fileContent2 = 'const foo bar = 1;'
    const searchString2 = 'const foobar = 1;'
    expect(findWhitespaceAgnosticMatch(fileContent2, searchString2)).toBeNull()
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
