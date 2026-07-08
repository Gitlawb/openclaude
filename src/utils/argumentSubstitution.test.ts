import { describe, expect, test } from 'bun:test'
import { substituteArguments } from './argumentSubstitution.js'

describe('substituteArguments named-argument regex safety', () => {
  test('substitutes a normal named argument', () => {
    expect(substituteArguments('hello $name', 'world', false, ['name'])).toBe(
      'hello world',
    )
  })

  // A frontmatter argument name is author-defined and unrestricted beyond
  // rejecting empty/numeric-only names, so a name with regex metacharacters must
  // be treated literally rather than compiled into a live pattern.
  test('does not over-match when the name contains a regex wildcard', () => {
    // Name `a.` must not let `.` match the `b` in `$ab`.
    expect(substituteArguments('$ab', 'X', false, ['a.'])).toBe('$ab')
    // The literal `$a.` placeholder still substitutes.
    expect(substituteArguments('$a.', 'X', false, ['a.'])).toBe('X')
  })

  test('does not throw when the name contains unbalanced regex characters', () => {
    for (const name of ['a)', 'a(', 'a[', 'a+', 'a*', 'a{2']) {
      expect(() =>
        substituteArguments('body has no placeholder', 'x', true, [name]),
      ).not.toThrow()
    }
  })

  test('substitutes a literal placeholder whose name has metacharacters', () => {
    expect(substituteArguments('run $a+b now', 'VAL', false, ['a+b'])).toBe(
      'run VAL now',
    )
  })
})
