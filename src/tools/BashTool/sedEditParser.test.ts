import { describe, expect, test } from 'bun:test'

import {
  applySedSubstitution,
  parseSedEditCommand,
  type SedEditInfo,
} from './sedEditParser.js'

function sedInfo(pattern: string, replacement: string, extendedRegex = false): SedEditInfo {
  return {
    filePath: 'example.txt',
    pattern,
    replacement,
    flags: 'g',
    extendedRegex,
  }
}

test('BRE mode keeps unescaped plus literal', () => {
  const result = applySedSubstitution(
    'a+b and aaab',
    sedInfo('a+b', 'literal-plus'),
  )

  expect(result).toBe('literal-plus and aaab')
})

test('BRE mode treats escaped plus as one-or-more', () => {
  const result = applySedSubstitution(
    'abbb and a+b',
    sedInfo('ab\\+', 'one-or-more'),
  )

  expect(result).toBe('one-or-more and a+b')
})

test('BRE mode preserves escaped backslashes', () => {
  const result = applySedSubstitution(
    String.raw`foo\bar foo/bar`,
    sedInfo(String.raw`foo\\bar`, 'backslash-match'),
  )

  expect(result).toBe('backslash-match foo/bar')
})

test('BRE mode treats escaped braces as an interval quantifier', () => {
  // `a\{2\}` is the BRE interval quantifier (exactly two a's). Before the fix
  // braces were omitted from the metacharacter set, so it was emitted as the
  // JS literal `a\{2\}` and matched nothing — the preview showed no change
  // while real sed rewrote the file.
  const result = applySedSubstitution('aa and a', sedInfo('a\\{2\\}', 'X'))
  expect(result).toBe('X and a')
})

test('BRE mode treats bare braces as literals', () => {
  // A bare `{2}` is literal in BRE, so it must not become a JS quantifier.
  const result = applySedSubstitution('a{2} and aa', sedInfo('a{2}', 'X'))
  expect(result).toBe('X and aa')
})

test('BRE mode supports escaped interval ranges', () => {
  // `b\{1,3\}` matches one-to-three b's; on "bbbc" it consumes the three b's
  // (the upper bound) and leaves the trailing "c".
  const result = applySedSubstitution('bbbc', sedInfo('b\\{1,3\\}', 'X'))
  expect(result).toBe('Xc')
})

test('BRE mode supports the open lower-bound interval \\{,m\\}', () => {
  // GNU sed accepts `\{,3\}` (up to three). JS has no `{,3}` quantifier, so it
  // must be normalized to `{0,3}`; otherwise the preview showed no change while
  // sed rewrote the run. Without `g` there is a single match, so sed's and JS's
  // differing empty-match advance cannot come into play.
  const result = applySedSubstitution('aaaab', {
    filePath: 'example.txt',
    pattern: 'a\\{,3\\}',
    replacement: 'X',
    flags: '',
    extendedRegex: false,
  })
  expect(result).toBe('Xab')
})

test('BRE mode supports the open upper-bound interval \\{n,\\}', () => {
  const result = applySedSubstitution('aaab', sedInfo('a\\{2,\\}', 'X'))
  expect(result).toBe('Xb')
})

test('BRE mode declines malformed intervals rather than guessing', () => {
  // GNU sed rejects both of these outright ("Invalid content of \{\}"), so the
  // command aborts and the file is untouched. They are not literal braces, and
  // there is no edit to render.
  expect(
    parseSedEditCommand("sed -i '' 's/a\\{\\}/X/g' example.txt"),
  ).toBeNull()
  expect(
    parseSedEditCommand("sed -i '' 's/a\\{1,2,3\\}/X/g' example.txt"),
  ).toBeNull()
})

test('BRE mode treats escaped alternation as an operator', () => {
  const result = applySedSubstitution(
    'cat and dog',
    sedInfo('cat\\|dog', 'X'),
  )
  expect(result).toBe('X and X')
})

test('BRE mode treats escaped groups and question marks as operators', () => {
  const result = applySedSubstitution('abab', sedInfo('\\(ab\\)\\+', 'X'))
  expect(result).toBe('X')

  const optional = applySedSubstitution('ac abc', sedInfo('ab\\?c', 'X'))
  expect(optional).toBe('X X')
})

test('BRE mode applies g across multiple interval quantifiers', () => {
  const result = applySedSubstitution(
    'aabb aabb',
    sedInfo('a\\{2\\}b\\{2\\}', 'X'),
  )
  expect(result).toBe('X X')
})

test('ERE mode uses native brace intervals', () => {
  // Under -E the braces are already the JS quantifier form and must pass
  // through untouched.
  const result = applySedSubstitution('aaab', sedInfo('a{2}', 'X', true))
  expect(result).toBe('Xab')
})

describe('declines to simulate what it cannot reproduce faithfully', () => {
  const cmd = (expr: string) => `sed -i '' '${expr}' example.txt`

  test('rejects zero-minimum intervals under g', () => {
    // sed and JS advance differently past an empty match, so a global
    // zero-minimum quantifier genuinely diverges: GNU sed turns "aaaab" into
    // "XXbX" for both of these, while a JS global replace yields "XXXbX".
    // Rendering that as an approved file diff would show the user a change that
    // is not what sed writes, so no sed edit is claimed at all.
    expect(parseSedEditCommand(cmd('s/a\\{0,3\\}/X/g'))).toBeNull()
    expect(parseSedEditCommand(cmd('s/a\\{,3\\}/X/g'))).toBeNull()
    // Same class, pre-dating interval support: `*` also matches empty.
    expect(parseSedEditCommand(cmd('s/a*/X/g'))).toBeNull()
  })

  test('still simulates zero-minimum intervals without g', () => {
    // Only one substitution happens, so the empty-match advance never matters.
    expect(parseSedEditCommand(cmd('s/a\\{0,3\\}/X/'))).not.toBeNull()
  })

  test('rejects interval syntax inside a bracket expression', () => {
    // `[\{,3\}]` is a bracket expression whose members are ordinary characters;
    // GNU sed turns "0,{3}" into "0XXXX". A backslash is a literal member in
    // POSIX brackets but an escape in a JS character class, so this cannot be
    // mapped across and must not be parsed as an interval.
    expect(parseSedEditCommand(cmd('s/[\\{,3\\}]/X/g'))).toBeNull()
  })

  test('still simulates ordinary bracket expressions', () => {
    const info = parseSedEditCommand(cmd('s/[abc]/X/g'))
    expect(info).not.toBeNull()
    expect(applySedSubstitution('abcd', info!)).toBe('XXXd')
  })

  test('rejects a pattern whose translation is not a valid regex', () => {
    // Previously `new RegExp` threw and the catch returned the original
    // content, rendering an invalid pattern as a silent "no change" diff.
    expect(parseSedEditCommand(cmd('s/a*\\{2\\}/X/g'))).toBeNull()
  })
})
