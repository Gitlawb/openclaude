import { describe, expect, test } from 'bun:test'
import { findWhitespaceAgnosticMatch, adjustNewStringIndentation } from './utils.js'

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

  test('prevents multiline strings from matching single-line strings with same tokens', () => {
    // P1: A newline in the search string should not match an inline space in the file
    const fileContent = 'const x = a + b;'
    const searchString = 'const x = a\n  + b;'
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBeNull()

    const fileContent2 = '.foo .bar { color: red; }'
    const searchString2 = '.foo\n  .bar { color: red; }'
    expect(findWhitespaceAgnosticMatch(fileContent2, searchString2)).toBeNull()
  })
})

describe('adjustNewStringIndentation', () => {
  test('returns newString unmodified if oldString and fileMatch have same indentation', () => {
    const oldString = '  foo();\n  bar();'
    const fileMatch = '  foo();\n  bar();'
    const newString = '  foo();\n  baz();'
    expect(adjustNewStringIndentation(oldString, fileMatch, newString)).toBe(newString)
  })

  test('adds indentation when file has more indentation', () => {
    const oldString = '  foo();\n  bar();'
    const fileMatch = '    foo();\n    bar();' // file has +2 spaces
    const newString = '  foo();\n  baz();\n  qux();' // newString has base 2 spaces
    const expected = '    foo();\n    baz();\n    qux();'
    expect(adjustNewStringIndentation(oldString, fileMatch, newString)).toBe(expected)
  })

  test('removes indentation when file has less indentation', () => {
    const oldString = '    foo();\n    bar();'
    const fileMatch = '  foo();\n  bar();' // file has -2 spaces
    const newString = '    foo();\n    baz();\n      qux();' // newString has base 4 spaces
    const expected = '  foo();\n  baz();\n    qux();'
    expect(adjustNewStringIndentation(oldString, fileMatch, newString)).toBe(expected)
  })

  test('handles completely different indentation styles (spaces vs tabs)', () => {
    const oldString = '  foo();\n  bar();'
    const fileMatch = '\tfoo();\n\tbar();'
    const newString = '  foo();\n    baz();'
    // It should replace the base indentation prefix
    const expected = '\tfoo();\n\t  baz();'
    expect(adjustNewStringIndentation(oldString, fileMatch, newString)).toBe(expected)
  })
})
