import { describe, expect, test } from 'bun:test'
import {
  findWhitespaceAgnosticMatch,
  adjustNewStringIndentation,
  getSnippetForTwoFileDiff,
} from './utils.js'

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

  test('recovers leading boundary horizontal whitespace without consuming line breaks', () => {
    const fileContent = 'function hello() {\n    foo();\n}'
    const searchString = '  foo();' // Agent provided leading spaces
    // Leading spaces are ignored in the match, and boundary expansion
    // recovers the exact file indentation. The `\n` is safely preserved!
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBe('    foo();')
  })

  test('prevents trailing-newline searches from consuming next line indentation', () => {
    const fileContent = 'if ok:\n  foo()\n  bar()\n'
    const searchString = '    foo()\n'
    const actualOldString = findWhitespaceAgnosticMatch(fileContent, searchString)
    expect(actualOldString).toBe('  foo()\n')
  })

  test('rejects fuzzy match when LLM collapses blank lines (CodeRabbit P2 fix)', () => {
    const fileContent = 'A paragraph.\n\nNext paragraph.'
    const searchString = 'A paragraph.\nNext paragraph.'
    // The exact newline count mismatch forces it to reject the fuzzy match.
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBeNull()
  })

  test('rejects fuzzy match when LLM hallucinates blank lines (CodeRabbit P2 fix)', () => {
    const fileContent = 'A paragraph.\nNext paragraph.'
    const searchString = 'A paragraph.\n\nNext paragraph.'
    // The exact newline count mismatch forces it to reject the fuzzy match.
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBeNull()
  })

  test('preserves Markdown hard breaks in fuzzy match (CodeRabbit P2 fix)', () => {
    const fileContent = 'foo  \nbar'
    const searchString = 'foo\nbar'
    // isMarkdown = true protects trailing spaces before a newline
    expect(findWhitespaceAgnosticMatch(fileContent, searchString, true)).toBeNull()
  })

  test('ignores trailing garbage spaces for non-Markdown files', () => {
    const fileContent = 'foo  \nbar'
    const searchString = 'foo\nbar'
    // isMarkdown = false drops trailing spaces to be agnostic
    expect(findWhitespaceAgnosticMatch(fileContent, searchString, false)).toBe('foo  \nbar')
  })

  test('keeps inline whitespace exact to protect semantics (CodeRabbit P2 fix)', () => {
    const fileContent = 'const msg = "hello  world";'
    const searchString = 'const msg = "hello world";'
    // The inline spaces do not match, so it rejects it!
    expect(findWhitespaceAgnosticMatch(fileContent, searchString)).toBeNull()
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

  test('rejects conflicting indentation maps (CodeRabbit P2 fix)', () => {
    const oldString = 'if ok:\n  foo()\n  bar()'
    // File actually has bar() outside the block
    const fileMatch = 'if ok:\n    foo()\nbar()'
    const newString = 'if ok:\n  baz()\n  qux()'
    // oldIndent "  " maps to "    " for foo(), but maps to "" for bar()
    // It should detect the conflict and return null
    expect(adjustNewStringIndentation(oldString, fileMatch, newString)).toBeNull()
  })
})

describe('getSnippetForTwoFileDiff truncation notice', () => {
  test('reports the exact number of dropped lines when cutting at a line boundary', () => {
    // A full-replacement diff of an empty file with a large file yields a single
    // hunk whose line-numbered snippet far exceeds DIFF_SNIPPET_MAX_BYTES (8192),
    // forcing truncation at a line boundary.
    const bigFile =
      Array.from({ length: 800 }, (_, i) => `line ${i + 1} content here`).join(
        '\n',
      ) + '\n'
    const snippet = getSnippetForTwoFileDiff('', bigFile)

    const match = snippet.match(/\.\.\. \[(\d+) lines truncated\] \.\.\./)
    expect(match).not.toBeNull()
    const reportedTruncated = Number(match![1])

    // The snippet body before the marker holds the kept lines. Together with the
    // reported truncated count they must sum to the total lines the untruncated
    // snippet would have shown — here, the 800 added lines. Before the fix the
    // boundary newline was double-counted and this reported 801.
    const keptBody = snippet.slice(0, snippet.indexOf('\n\n... ['))
    const keptLines = keptBody.split('\n').length

    expect(keptLines + reportedTruncated).toBe(800)
  })
})

describe('getSnippetForTwoFileDiff line numbering', () => {
  test('numbers later hunks by their new-file position', () => {
    const a = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')
    // First hunk inserts 3 lines near the top; second hunk changes a line near
    // the bottom, so the second hunk's new-file start is 3 greater than its
    // old-file start.
    const bLines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`)
    bLines.splice(3, 0, 'INSERTED A', 'INSERTED B', 'INSERTED C')
    bLines[57] = 'CHANGED near bottom' // original line 55, now at new-file line 58
    const b = bLines.join('\n')

    const snippet = getSnippetForTwoFileDiff(a, b)

    // The changed line sits at line 58 in the new file. Before the fix it was
    // labeled 55 (its old-file number), off by the net +3 of the first hunk.
    const changedLine = snippet
      .split('\n')
      .find(l => l.includes('CHANGED near bottom'))
    expect(changedLine).toBeDefined()
    expect(changedLine!.trim()).toStartWith('58→')
  })
})
