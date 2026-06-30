import { expect, test } from 'bun:test'
import { splitPathInFrontmatter } from './frontmatterParser.ts'

// splitPathInFrontmatter is the public entry that flatMaps each comma-separated
// part through the (private) expandBraces helper, so it exercises the brace
// expansion that loadSkillsDir.ts and claudemd.ts depend on for path-scoped
// activation. These cover the regression where the old `[^}]+` regex stopped at
// the first '}' and corrupted nested groups (leaving stray '}' in globs).

test('passes through a pattern with no braces unchanged', () => {
  expect(splitPathInFrontmatter('src/index.ts')).toEqual(['src/index.ts'])
})

test('expands a single-level brace group', () => {
  expect(splitPathInFrontmatter('a.{js,ts}')).toEqual(['a.js', 'a.ts'])
})

test('expands a nested brace group without leaking braces', () => {
  expect(splitPathInFrontmatter('{a,{b,c}}')).toEqual(['a', 'b', 'c'])
})

test('expands a nested glob group into valid globs', () => {
  expect(splitPathInFrontmatter('src/**/*.{js,{ts,tsx}}')).toEqual([
    'src/**/*.js',
    'src/**/*.ts',
    'src/**/*.tsx',
  ])
})

test('expands sibling brace groups as a cartesian product', () => {
  expect(splitPathInFrontmatter('{a,b}/{c,d}')).toEqual([
    'a/c',
    'a/d',
    'b/c',
    'b/d',
  ])
})

test('returns unbalanced braces unchanged rather than throwing', () => {
  // No matching close brace: treat as literal text, do not corrupt or throw.
  expect(splitPathInFrontmatter('src/{a,b')).toEqual(['src/{a,b'])
})

test('keeps an empty brace group literal instead of yielding an empty path', () => {
  // `{}` is not an alternation. Expanding it to '' would make parseSkillPaths
  // and the CLAUDE.md path parser drop the empty string and treat the file as
  // having NO path restriction (activating everywhere). Keep it literal so the
  // pattern matches a literal `{}` (i.e. effectively nothing) instead.
  expect(splitPathInFrontmatter('{}')).toEqual(['{}'])
  expect(splitPathInFrontmatter('src/{}/file.ts')).toEqual(['src/{}/file.ts'])
})

test('keeps a literal empty group while still expanding later groups', () => {
  expect(splitPathInFrontmatter('{}/{a,b}')).toEqual(['{}/a', '{}/b'])
})
