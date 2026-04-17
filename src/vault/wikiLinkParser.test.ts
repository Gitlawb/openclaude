import { describe, test, expect } from 'bun:test'
import { parseWikiLinkTarget } from './wikiLinkParser.js'

describe('parseWikiLinkTarget', () => {
  test('no prefix → local', () => {
    expect(parseWikiLinkTarget('foo')).toEqual({ vault: 'local', slug: 'foo' })
    expect(parseWikiLinkTarget('concept-binary-trees')).toEqual({
      vault: 'local',
      slug: 'concept-binary-trees',
    })
  })

  test('global: prefix → global', () => {
    expect(parseWikiLinkTarget('global:foo')).toEqual({
      vault: 'global',
      slug: 'foo',
    })
    expect(parseWikiLinkTarget('global:dev-principle-tdd')).toEqual({
      vault: 'global',
      slug: 'dev-principle-tdd',
    })
  })

  test('project: prefix → project', () => {
    expect(parseWikiLinkTarget('project:foo')).toEqual({
      vault: 'project',
      slug: 'foo',
    })
  })

  test('empty after prefix → literal local slug', () => {
    expect(parseWikiLinkTarget('global:')).toEqual({
      vault: 'local',
      slug: 'global:',
    })
    expect(parseWikiLinkTarget('project:')).toEqual({
      vault: 'local',
      slug: 'project:',
    })
  })

  test('no colon → no prefix even if word matches', () => {
    expect(parseWikiLinkTarget('global')).toEqual({
      vault: 'local',
      slug: 'global',
    })
    expect(parseWikiLinkTarget('project')).toEqual({
      vault: 'local',
      slug: 'project',
    })
  })

  test('unknown prefix → literal local slug (parser stays tolerant)', () => {
    expect(parseWikiLinkTarget('unknown:foo')).toEqual({
      vault: 'local',
      slug: 'unknown:foo',
    })
    // Useful real-world example: a slug that legitimately contains a colon.
    expect(parseWikiLinkTarget('version:1.2.3')).toEqual({
      vault: 'local',
      slug: 'version:1.2.3',
    })
  })

  test('whitespace trimmed at edges', () => {
    expect(parseWikiLinkTarget('  global:foo  ')).toEqual({
      vault: 'global',
      slug: 'foo',
    })
    expect(parseWikiLinkTarget('\tfoo\n')).toEqual({
      vault: 'local',
      slug: 'foo',
    })
  })

  test('slug after global: can contain dots, slashes, dashes (no further parsing)', () => {
    expect(parseWikiLinkTarget('global:foo-bar')).toEqual({
      vault: 'global',
      slug: 'foo-bar',
    })
    expect(parseWikiLinkTarget('global:foo.bar')).toEqual({
      vault: 'global',
      slug: 'foo.bar',
    })
  })
})
