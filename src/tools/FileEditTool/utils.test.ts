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

  test('recovers nested structure when root has no indentation (CodeRabbit P2 fix)', () => {
    const oldString = 'if ok:\n  foo()'
    const fileMatch = 'if ok:\n    foo()' // file uses 4 spaces instead of 2 for nested line
    const newString = 'if ok:\n  bar()'
    // It should preserve the nested 4 spaces for bar() even though the root `if ok:` is 0 spaces
    const expected = 'if ok:\n    bar()'
    expect(adjustNewStringIndentation(oldString, fileMatch, newString)).toBe(expected)
  })

  test('handles deeper unseen relative indentation intelligently', () => {
    const oldString = 'if ok:\n  foo()'
    const fileMatch = 'if ok:\n    foo()'
    const newString = 'if ok:\n  for x in y:\n    bar()' // LLM added a deeper block at 4 spaces
    // It should map 0 -> 0, 2 -> 4, and 4 -> 4 + 2 remaining = 6
    const expected = 'if ok:\n    for x in y:\n      bar()'
    expect(adjustNewStringIndentation(oldString, fileMatch, newString)).toBe(expected)
  })

  test('adds indentation when file has more overall indentation', () => {
    const oldString = '  foo();\n  bar();'
    const fileMatch = '    foo();\n    bar();' // file has +2 spaces
    const newString = '  foo();\n  baz();\n  qux();' // newString has base 2 spaces
    const expected = '    foo();\n    baz();\n    qux();'
    expect(adjustNewStringIndentation(oldString, fileMatch, newString)).toBe(expected)
  })

  test('removes indentation when file has less overall indentation', () => {
    const oldString = '    if ok:\n      foo();'
    const fileMatch = '  if ok:\n    foo();' // file has 2 spaces instead of 4
    const newString = '    if ok:\n      bar();\n        baz();' // newString has deeper nest
    const expected = '  if ok:\n    bar();\n      baz();'
    expect(adjustNewStringIndentation(oldString, fileMatch, newString)).toBe(expected)
  })

  test('handles completely different indentation styles (spaces vs tabs)', () => {
    const oldString = '  if ok:\n    foo();'
    const fileMatch = '\tif ok:\n\t\tfoo();'
    const newString = '  if ok:\n      baz();' // added deeper space indent
    const expected = '\tif ok:\n\t\t  baz();' // prepends tab prefix and keeps remaining spaces
    expect(adjustNewStringIndentation(oldString, fileMatch, newString)).toBe(expected)
  })
})
