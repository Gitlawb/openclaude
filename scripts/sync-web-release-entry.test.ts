import { describe, expect, test } from 'bun:test'

import {
  deriveTheme,
  formatReleaseEntry,
  GENERATED_ENTRY_MARKER,
  insertReleaseEntry,
  parseChangelogSection,
  readCurrentTopVersion,
  sanitizeChangelogBullet,
  syncWebReleaseEntry,
} from './sync-web-release-entry'

const SAMPLE_CHANGELOG = `# Changelog

## [0.28.0](https://github.com/Gitlawb/openclaude/compare/v0.27.0...v0.28.0) (2026-08-10)

### Features

* **auth:** opt-in loopback proxy hosts ([#2050](https://github.com/Gitlawb/openclaude/issues/2050)) ([3925f27](https://github.com/Gitlawb/openclaude/commit/3925f27))
* **web:** replace favicon/logo with Ember Block O brand mark ([#2065](https://github.com/Gitlawb/openclaude/issues/2065)) ([56a9201](https://github.com/Gitlawb/openclaude/commit/56a9201))
* third highlight
* fourth highlight
* fifth highlight
* sixth highlight
`

const SAMPLE_RELEASES_TS = `export const releases: Release[] = [
  {
    version: '0.27.0',
    date: '2026-07-30',
    theme: 'existing',
    highlights: ['one'],
  },
]
`

describe('syncWebReleaseEntry', () => {
  test('inserts a bounded, sanitized draft entry from the requested changelog section', () => {
    const result = syncWebReleaseEntry({
      changelog: SAMPLE_CHANGELOG,
      releasesTs: SAMPLE_RELEASES_TS,
      baseReleasesTs: SAMPLE_RELEASES_TS,
      manifestVersion: '0.28.0',
    })

    expect(result.status).toBe('updated')
    if (result.status !== 'updated') return
    expect(readCurrentTopVersion(result.content)).toBe('0.28.0')
    expect(result.content).toContain("version: '0.27.0'")
    expect(result.content).toContain('auth: opt-in loopback proxy hosts')
    expect(result.content).toContain('fifth highlight')
    expect(result.content).not.toContain('sixth highlight')
    expect(result.content).toContain(GENERATED_ENTRY_MARKER)
  })

  test('replaces an already-generated release PR entry when its version changes', () => {
    const generated = insertReleaseEntry(SAMPLE_RELEASES_TS, {
      version: '0.28.0',
      date: '2026-08-09',
      theme: 'old theme',
      highlights: ['old highlight'],
    })
    const result = syncWebReleaseEntry({
      changelog: SAMPLE_CHANGELOG.replaceAll('0.28.0', '0.29.0'),
      releasesTs: generated,
      baseReleasesTs: SAMPLE_RELEASES_TS,
      manifestVersion: '0.29.0',
    })

    expect(result.status).toBe('updated')
    if (result.status !== 'updated') return
    expect(result.content).toContain('version: "0.29.0"')
    expect(result.content).not.toContain('version: "0.28.0"')
    expect(result.content.match(new RegExp(GENERATED_ENTRY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1)
  })

  test('preserves a published entry when creating the next release', () => {
    const published = insertReleaseEntry(SAMPLE_RELEASES_TS, {
      version: '0.28.0',
      date: '2026-08-10',
      theme: 'ready',
      highlights: ['ready'],
    })
    const result = syncWebReleaseEntry({
      changelog: SAMPLE_CHANGELOG.replaceAll('0.28.0', '0.29.0'),
      releasesTs: published,
      baseReleasesTs: published,
      manifestVersion: '0.29.0',
    })

    expect(result.status).toBe('updated')
    if (result.status !== 'updated') return
    expect(result.content).toContain('version: "0.29.0"')
    expect(result.content).toContain('version: "0.28.0"')
    expect(result.content.match(new RegExp(GENERATED_ENTRY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1)
  })

  test('strips the leftover automation marker across consecutive restore-from-base syncs', () => {
    const first = syncWebReleaseEntry({
      changelog: SAMPLE_CHANGELOG,
      releasesTs: SAMPLE_RELEASES_TS,
      baseReleasesTs: SAMPLE_RELEASES_TS,
      manifestVersion: '0.28.0',
    })
    expect(first.status).toBe('updated')
    if (first.status !== 'updated') return

    // CI restores releases.ts from merge-base after the previous release merged,
    // so the working tree matches the marked published entry on main.
    const second = syncWebReleaseEntry({
      changelog: SAMPLE_CHANGELOG.replaceAll('0.28.0', '0.29.0'),
      releasesTs: first.content,
      baseReleasesTs: first.content,
      manifestVersion: '0.29.0',
    })
    expect(second.status).toBe('updated')
    if (second.status !== 'updated') return
    expect(readCurrentTopVersion(second.content)).toBe('0.29.0')
    expect(second.content).toContain('version: "0.28.0"')
    expect(second.content).toContain("version: '0.27.0'")
    expect(second.content.match(new RegExp(GENERATED_ENTRY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1)
  })

  test('refreshes a generated same-version entry when changelog bullets change', () => {
    const generated = insertReleaseEntry(SAMPLE_RELEASES_TS, {
      version: '0.28.0',
      date: '2026-08-09',
      theme: 'stale',
      highlights: ['stale highlight'],
    })
    const result = syncWebReleaseEntry({
      changelog: SAMPLE_CHANGELOG,
      releasesTs: generated,
      baseReleasesTs: generated,
      manifestVersion: '0.28.0',
    })

    expect(result.status).toBe('updated')
    if (result.status !== 'updated') return
    expect(result.content).toContain('auth: opt-in loopback proxy hosts')
    expect(result.content).not.toContain('stale highlight')
    expect(result.content.match(new RegExp(GENERATED_ENTRY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1)
  })

  test('replaces an updated entry for the same release version', () => {
    const generated = insertReleaseEntry(SAMPLE_RELEASES_TS, {
      version: '0.29.0',
      date: '2026-08-17',
      theme: 'draft',
      highlights: ['draft'],
    })
    const result = syncWebReleaseEntry({
      changelog: SAMPLE_CHANGELOG.replaceAll('0.28.0', '0.29.0').replace('opt-in loopback proxy hosts', 'updated'),
      releasesTs: generated,
      baseReleasesTs: SAMPLE_RELEASES_TS,
      manifestVersion: '0.29.0',
    })
    expect(result.status).toBe('updated')
    if (result.status !== 'updated') return
    expect(result.content).toContain('theme: "updated"')
    expect(result.content.match(/version: "0.29.0"/g)).toHaveLength(1)
  })

  test('replaces a generated entry in a CRLF checkout and preserves its line endings', () => {
    const generated = insertReleaseEntry(SAMPLE_RELEASES_TS, {
      version: '0.28.0',
      date: '2026-08-10',
      theme: 'draft',
      highlights: ['draft'],
    }).replaceAll('\n', '\r\n')
    const result = syncWebReleaseEntry({
      changelog: SAMPLE_CHANGELOG.replaceAll('0.28.0', '0.29.0'),
      releasesTs: generated,
      baseReleasesTs: SAMPLE_RELEASES_TS,
      manifestVersion: '0.29.0',
    })

    expect(result.status).toBe('updated')
    if (result.status !== 'updated') return
    expect(result.content).toContain('version: "0.29.0"')
    expect(result.content.replaceAll('\r\n', '')).not.toContain('\n')
  })

  test('refuses unmarked divergence for the target version', () => {
    const curated = insertReleaseEntry(SAMPLE_RELEASES_TS, {
      version: '0.28.0',
      date: '2026-08-10',
      theme: 'curated theme',
      highlights: ['curated highlight'],
    }).replace(`${GENERATED_ENTRY_MARKER}\n`, '')

    expect(() => syncWebReleaseEntry({
      changelog: SAMPLE_CHANGELOG,
      releasesTs: curated,
      baseReleasesTs: SAMPLE_RELEASES_TS,
      manifestVersion: '0.28.0',
    })).toThrow('differs from the base without the generated-entry marker')
  })

  test('still refreshes entries that use the legacy generated-entry marker', () => {
    const legacyMarker =
      '  // Generated by release automation; remove this comment before hand-curating.'
    const existing = insertReleaseEntry(SAMPLE_RELEASES_TS, {
      version: '0.28.0',
      date: '2026-08-10',
      theme: 'old theme',
      highlights: ['old highlight'],
    }).replace(GENERATED_ENTRY_MARKER, legacyMarker)

    const result = syncWebReleaseEntry({
      changelog: SAMPLE_CHANGELOG.replace('third highlight', 'updated third highlight'),
      releasesTs: existing,
      baseReleasesTs: SAMPLE_RELEASES_TS,
      manifestVersion: '0.28.0',
    })

    expect(result.status).toBe('updated')
    if (result.status !== 'updated') return
    expect(result.content).toContain(GENERATED_ENTRY_MARKER)
    expect(result.content).not.toContain(legacyMarker)
    expect(result.content).toContain('updated third highlight')
  })

  test('refuses to overwrite an unmarked divergent pending entry for another version', () => {
    const curated = insertReleaseEntry(SAMPLE_RELEASES_TS, {
      version: '0.28.0',
      date: '2026-08-10',
      theme: 'curated theme',
      highlights: ['curated highlight'],
    }).replace(`${GENERATED_ENTRY_MARKER}\n`, '')

    expect(() => syncWebReleaseEntry({
      changelog: SAMPLE_CHANGELOG.replaceAll('0.28.0', '0.29.0'),
      releasesTs: curated,
      baseReleasesTs: SAMPLE_RELEASES_TS,
      manifestVersion: '0.29.0',
    })).toThrow('differs from the base without the generated-entry marker')
  })

  test('is a no-op when the top entry already matches without a draft marker', () => {
    const releasesTs = SAMPLE_RELEASES_TS.replace("version: '0.27.0'", "version: '0.28.0'")
    expect(
      syncWebReleaseEntry({
        changelog: SAMPLE_CHANGELOG,
        releasesTs,
        baseReleasesTs: releasesTs,
        manifestVersion: '0.28.0',
      }),
    ).toEqual({
      status: 'unchanged',
      version: '0.28.0',
      reason: 'releases.ts already lists this version first',
    })
  })

  test('rejects a missing version section and an empty release section', () => {
    expect(() =>
      syncWebReleaseEntry({
        changelog: SAMPLE_CHANGELOG,
        releasesTs: SAMPLE_RELEASES_TS,
        baseReleasesTs: SAMPLE_RELEASES_TS,
        manifestVersion: '9.9.9',
      }),
    ).toThrow('no CHANGELOG.md section found for version 9.9.9')
    expect(() =>
      syncWebReleaseEntry({
        changelog: '## [0.28.0](url) (2026-08-10)\n',
        releasesTs: SAMPLE_RELEASES_TS,
        baseReleasesTs: SAMPLE_RELEASES_TS,
        manifestVersion: '0.28.0',
      }),
    ).toThrow('CHANGELOG.md section for 0.28.0 has no bullet highlights')
  })

  test('requires an explicit trusted base', () => {
    expect(() =>
      syncWebReleaseEntry({
        changelog: SAMPLE_CHANGELOG,
        releasesTs: SAMPLE_RELEASES_TS,
        manifestVersion: '0.28.0',
      }),
    ).toThrow('missing base release ref')
  })
})

describe('formatting helpers', () => {
  test('strips markdown and trailing changelog references', () => {
    expect(
      sanitizeChangelogBullet('* **auth:** ready ([#12](https://example.test/12)) ([abcdef1](https://example.test))'),
    ).toBe('auth: ready')
    expect(sanitizeChangelogBullet('* accept &lt;tag&gt;, arrows -&gt; and &#x1F525;')).toBe(
      'accept <tag>, arrows -> and 🔥',
    )
    expect(sanitizeChangelogBullet('* invalid &#x110000; and &#55296;')).toBe(
      'invalid &#x110000; and &#55296;',
    )
  })

  test('derives safe compact themes and escapes generated strings', () => {
    expect(deriveTheme([])).toBe('release highlights')
    expect(deriveTheme(['plain highlight'])).toBe('plain highlight')
    expect(deriveTheme([`scope: ${'x'.repeat(80)}`])).toBe(`${'x'.repeat(69)}…`)
    expect(deriveTheme([`scope: ${'x'.repeat(68)}🔥more`])).toBe(`${'x'.repeat(68)}🔥…`)
    expect(formatReleaseEntry({ version: '0.28.0', date: '2026-08-10', theme: "it's\rready", highlights: ["don't"] })).toContain(
      'theme: "it\'s\\rready"',
    )
  })

  test('parses only the requested release section', () => {
    expect(parseChangelogSection(`${SAMPLE_CHANGELOG}\n## [0.27.0](url) (2026-07-30)\n* old`, '0.28.0')?.highlights).toHaveLength(5)
  })
})
