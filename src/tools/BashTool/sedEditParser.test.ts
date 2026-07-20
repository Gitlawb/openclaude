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

test('BRE mode declines the GNU-only escaped plus and question mark', () => {
  // `\+` and `\?` are GNU extensions: BSD/macOS sed matches them as literal
  // `+`/`?`, so one platform's operator is the other's literal and a single
  // preview cannot be right for both.
  expect(
    parseSedEditCommand("sed -i '' 's/ab\\+/X/' example.txt"),
  ).toBeNull()
  expect(
    parseSedEditCommand("sed -i '' 's/ab\\?c/X/' example.txt"),
  ).toBeNull()
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

test('BRE mode declines the GNU-only open lower-bound interval \\{,m\\}', () => {
  // `\{,3\}` is a GNU extension: BSD/macOS sed rejects it and leaves the file
  // untouched, and this parser explicitly supports macOS via its `-i ''`
  // handling. Previewing a {0,3} result would show an edit on platforms where
  // the real command fails, so no sed edit is claimed even without `g`.
  expect(
    parseSedEditCommand("sed -i '' 's/a\\{,3\\}/X/' example.txt"),
  ).toBeNull()
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

test('BRE mode declines alternation rather than mis-selecting a branch', () => {
  // POSIX regex picks the leftmost-longest alternative while JavaScript picks
  // the first that matches: sed writes `\(a\|aa\)` on "aa" as "X", a JS
  // preview as "Xa". Selection cannot be reproduced, so no edit is claimed.
  expect(
    parseSedEditCommand("sed -i '' 's/cat\\|dog/X/g' example.txt"),
  ).toBeNull()
  expect(
    parseSedEditCommand("sed -i '' 's/\\(a\\|aa\\)\\{1\\}/X/' example.txt"),
  ).toBeNull()
})

test('BRE mode keeps escaped groups with portable interval quantifiers', () => {
  // `\(...\)` and `\{n\}` are POSIX BRE, supported identically by GNU and
  // BSD sed, so groups repeated via an interval still simulate.
  const result = applySedSubstitution('abab cd', sedInfo('\\(ab\\)\\{2\\}', 'X'))
  expect(result).toBe('X cd')
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

  test('rejects an unterminated bracket expression', () => {
    // GNU sed rejects `s/[/X/g` with an unterminated-address error and leaves
    // the file untouched; rendering `[` as a literal would persist an edit the
    // command cannot perform.
    expect(parseSedEditCommand(cmd('s/[/X/g'))).toBeNull()
  })

  test('rejects POSIX character classes JavaScript cannot interpret', () => {
    // `[[:digit:]]` is a digit class to sed but a plain character set to a JS
    // regex, so the two produce different files ("1a2": sed XaX, JS unchanged).
    expect(parseSedEditCommand(cmd('s/[[:digit:]]/X/g'))).toBeNull()
    expect(
      parseSedEditCommand("sed -i '' -E 's/[[:alpha:]]+/X/g' example.txt"),
    ).toBeNull()
  })

  test('rejects ERE alternation for the same POSIX-selection reason', () => {
    expect(
      parseSedEditCommand("sed -i '' -E 's/(a|aa)/X/' example.txt"),
    ).toBeNull()
  })

  test('rejects numeric occurrence flags it does not model', () => {
    // `2` selects the second match on each line, but the simulator always
    // rewrites the first: sed turns "aaaa" into "aaX", a preview into "Xaa".
    expect(parseSedEditCommand(cmd('s/a\\{2\\}/X/2'))).toBeNull()
    expect(parseSedEditCommand(cmd('s/a/X/9'))).toBeNull()
    // `p` prints and `m`/`M` redefine ^ and $ inside the pattern space.
    expect(parseSedEditCommand(cmd('s/a/X/p'))).toBeNull()
    expect(parseSedEditCommand(cmd('s/a/X/m'))).toBeNull()
  })

  test('rejects replacements carrying sed-specific syntax', () => {
    // `\1` is a backreference to sed but two literal characters to the
    // simulator: sed rewrites "aa" as "a", the preview as "\1".
    expect(parseSedEditCommand(cmd('s/\\(a\\)\\{2\\}/\\1/'))).toBeNull()
    expect(parseSedEditCommand(cmd('s/a/\\n/'))).toBeNull()
    // A plain literal replacement still simulates.
    expect(parseSedEditCommand(cmd('s/a/X/'))).not.toBeNull()
  })

  test('rejects escapes whose sed meaning is not the JavaScript meaning', () => {
    // GNU sed reads `\<`/`\>` as word boundaries; JS reads literal angle
    // brackets, so the preview shows no change while sed rewrites the file.
    expect(parseSedEditCommand(cmd('s/\\<foo\\>/X/g'))).toBeNull()
    // The converse: `\d` is a digit class in JS but a literal `d` in BRE.
    expect(parseSedEditCommand(cmd('s/\\d/X/g'))).toBeNull()
    expect(parseSedEditCommand(cmd('s/\\w/X/g'))).toBeNull()
  })

  test('rejects ^ and $ where BRE treats them as literals', () => {
    // Bare `^`/`$` only anchor at a BRE boundary; elsewhere sed matches them
    // literally while JS always reads an anchor.
    expect(parseSedEditCommand(cmd('s/a^b/X/'))).toBeNull()
    expect(parseSedEditCommand(cmd('s/a$b/X/'))).toBeNull()
    // Genuine anchors still simulate.
    expect(parseSedEditCommand(cmd('s/^a/X/'))).not.toBeNull()
    expect(parseSedEditCommand(cmd('s/a$/X/'))).not.toBeNull()
  })

  test('validates interval bodies on the ERE path too', () => {
    // JS reads `a{,3}` as literal braces; GNU sed -E applies its extension and
    // rewrites "aaaab" to "XXbX", and BSD has no portable behavior.
    expect(
      parseSedEditCommand("sed -i '' -E 's/a{,3}/X/g' example.txt"),
    ).toBeNull()
    expect(
      parseSedEditCommand("sed -i '' -E 's/a{1,2,3}/X/g' example.txt"),
    ).toBeNull()
  })

  test('counts characters like sed, not UTF-16 code units', () => {
    // Verified against GNU sed 4.10: `s/.\{2\}/X/` on the emoji + "a" writes a
    // bare "X". Without a unicode-aware matcher the quantifier consumes only
    // the emoji's surrogate pair and leaves the "a".
    const info = parseSedEditCommand(cmd('s/.\\{2\\}/X/'))
    expect(info).not.toBeNull()
    expect(applySedSubstitution('\u{1F600}a', info!)).toBe('X')
  })

  test('matches a carriage return the way sed pattern space does', () => {
    // Verified against GNU sed 4.10: `s/./X/g` on "a\r\n" writes "XX\n" — the
    // CR is an ordinary character in the pattern space. A JS `.` excludes
    // carriage returns and would leave it in place.
    const info = parseSedEditCommand(cmd('s/./X/g'))
    expect(info).not.toBeNull()
    expect(applySedSubstitution('a\r\n', info!)).toBe('XX\n')
  })

  test('rejects a standalone empty pattern', () => {
    // `s//X/` has no previous regular expression to reuse, so sed errors and
    // leaves the file untouched; an empty JS regex would prefix every line.
    expect(parseSedEditCommand(cmd('s//X/'))).toBeNull()
  })

  test('applies the substitution once per line like sed, not once per file', () => {
    // sed substitutes the first match on EVERY line even without `g`.
    const info = parseSedEditCommand(cmd('s/a\\{2\\}/X/'))
    expect(info).not.toBeNull()
    expect(applySedSubstitution('aa\naa\n', info!)).toBe('X\nX\n')
    // With `g`, all matches on every line.
    const g = parseSedEditCommand(cmd('s/a\\{2\\}/X/g'))
    expect(applySedSubstitution('aaaa\naa b aa\n', g!)).toBe('XX\nX b X\n')
    // A trailing newline is preserved and never treated as an extra empty line.
    expect(applySedSubstitution('aa', info!)).toBe('X')
  })

  test('leaves an empty file empty like sed', () => {
    // An empty file has no lines: sed never runs the substitution, so even an
    // anchored pattern that matches the empty string writes nothing.
    const info = parseSedEditCommand(cmd('s/^/X/'))
    expect(info).not.toBeNull()
    expect(applySedSubstitution('', info!)).toBe('')
  })
})
