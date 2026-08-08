import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { verifyDist, npmFreshnessFailure } from './verify-dist'
import { SITE } from '../src/data/site'
import { docsPages } from '../src/data/docsNav'
import { releases, releaseUrl } from '../src/data/releases'
import { heroes } from '../src/data/buddy'
import { partners, community } from '../src/data/partners'

function writePage(dist: string, route: string, html: string): void {
  const dir = join(dist, route.replace(/^\//, ''))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), html)
}

/** Build a minimal dist/ that satisfies every verifyDist assertion. */
function writeValidFixture(dist: string): void {
  const navLinks = ['/buddy/', '/changelog/'].map(h => `<a href="${h}">x</a>`).join('')
  writePage(
    dist,
    '/',
    `<html>v${SITE.version}${navLinks}${partners
      .map(p => `<a href="${p.url}"><img src="${p.logo}"></a>`)
      .join('')}${community.map(c => `<a href="${c.url}">x</a>`).join('')}</html>`,
  )
  const sidebar = docsPages.map(p => `<a href="${p.href}">x</a>`).join('')
  for (const p of docsPages) writePage(dist, p.href, `<html>${sidebar}</html>`)
  writePage(
    dist,
    '/changelog/',
    `<html>v${SITE.version}${releases
      .map(r => `<a href="${releaseUrl(r.version)}">v${r.version}</a>`)
      .join('')}</html>`,
  )
  writePage(
    dist,
    '/buddy/',
    `<html>${heroes.map(h => `<img src="/buddy/${h.id}.svg"><p>${h.attack}</p>`).join('')}</html>`,
  )
  mkdirSync(join(dist, 'buddy'), { recursive: true })
  for (const h of heroes) writeFileSync(join(dist, 'buddy', `${h.id}.svg`), '<svg/>')
  writeFileSync(
    join(dist, 'sitemap-0.xml'),
    `<urlset>${['/buddy/', '/changelog/'].map(r => `<loc>${SITE.url}${r}</loc>`).join('')}</urlset>`,
  )
}

function withFixture(mutate: (dist: string) => void): string[] {
  const dist = mkdtempSync(join(tmpdir(), 'verify-dist-'))
  try {
    writeValidFixture(dist)
    mutate(dist)
    return verifyDist(dist)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
}

describe('release data', () => {
  test('keeps releases newest first', () => {
    const versions = releases.map(release => release.version.split('.').map(Number))
    const sorted = [...versions].sort((a, b) => {
      for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return (b[i] ?? 0) - (a[i] ?? 0)
      }
      return 0
    })

    expect(versions).toEqual(sorted)
  })

  test('lists the 0.27.0 release with its curated highlights', () => {
    expect(releases.find(release => release.version === '0.27.0')).toEqual({
      version: '0.27.0',
      date: '2026-07-30',
      theme: 'auth-ready local proxies and a refreshed web identity',
      highlights: [
        'opt-in loopback proxy hosts preserve subscription OAuth authentication',
        'new Ling 3.0 Flash and Macaron V1 Tall catalog entries',
        'centered startup logo and updated Ember Block O web branding',
        'agents can spawn subagents from multi-repository parent sessions',
        'more reliable tool-failure guard, SDK permission-timeout reporting, stats, and status UI',
      ],
    })
  })
})

describe('verifyDist', () => {
  test('passes on a complete fixture', () => {
    expect(withFixture(() => {})).toEqual([])
  })

  test('flags a missing page', () => {
    const failures = withFixture(dist => rmSync(join(dist, 'buddy', 'index.html')))
    expect(failures).toContain('missing page for route /buddy/')
  })

  test('flags a present-but-empty page instead of skipping its assertions', () => {
    const failures = withFixture(dist => writeFileSync(join(dist, 'index.html'), '  \n'))
    expect(failures).toContain('empty page for route /')
    // and it must not drown the report in per-needle noise for that page
    expect(failures.filter(f => f.startsWith('landing '))).toEqual([])
  })

  test('flags a docs sidebar that lost a navigation link', () => {
    const failures = withFixture(dist => {
      const sidebar = docsPages
        .filter(p => p.href !== '/changelog/')
        .map(p => `<a href="${p.href}">x</a>`)
        .join('')
      writePage(dist, '/docs/', `<html>${sidebar}</html>`)
    })
    expect(failures).toContain('docs sidebar link /changelog/: missing "href=\\"/changelog/\\""')
  })

  test('flags a missing sprite asset', () => {
    const hero = heroes[0]!
    const failures = withFixture(dist => rmSync(join(dist, 'buddy', `${hero.id}.svg`)))
    expect(failures).toContain(`missing sprite asset /buddy/${hero.id}.svg`)
  })

  test('flags a stale landing page missing a partner link', () => {
    const failures = withFixture(dist => {
      const html = `<html>v${SITE.version}<a href="/buddy/">x</a><a href="/changelog/">x</a>${community
        .map(c => `<a href="${c.url}">x</a>`)
        .join('')}</html>`
      writeFileSync(join(dist, 'index.html'), html)
    })
    expect(failures.some(f => f.startsWith(`partner link ${partners[0]!.name}`))).toBe(true)
  })

  test('flags a sitemap missing the new routes', () => {
    const failures = withFixture(dist =>
      writeFileSync(join(dist, 'sitemap-0.xml'), `<urlset><loc>${SITE.url}/</loc></urlset>`),
    )
    expect(failures.some(f => f.startsWith('sitemap entry /buddy/'))).toBe(true)
    expect(failures.some(f => f.startsWith('sitemap entry /changelog/'))).toBe(true)
  })

  test('flags a missing sitemap', () => {
    const failures = withFixture(dist => rmSync(join(dist, 'sitemap-0.xml')))
    expect(failures).toContain('missing dist/sitemap-0.xml')
  })

  test('flags a changelog entry that lost its release URL', () => {
    const failures = withFixture(dist => {
      const html = `<html>v${SITE.version}${releases.map(r => `v${r.version}`).join(' ')}</html>`
      writeFileSync(join(dist, 'changelog', 'index.html'), html)
    })
    expect(failures.some(f => f.startsWith('changelog release URL'))).toBe(true)
  })
})

describe('npmFreshnessFailure', () => {
  function fetchReturning(body: unknown, ok = true): typeof fetch {
    return (() =>
      Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)) as typeof fetch
  }

  test('passes when npm matches the site version', async () => {
    expect(await npmFreshnessFailure(fetchReturning({ version: SITE.version }))).toBeNull()
  })

  test('passes when the site is ahead of npm (release PR before publish)', async () => {
    expect(await npmFreshnessFailure(fetchReturning({ version: '0.1.0' }))).toBeNull()
  })

  test('fails when npm has a newer release than releases.ts', async () => {
    const failure = await npmFreshnessFailure(fetchReturning({ version: '999.0.0' }))
    expect(failure).toContain('999.0.0')
    expect(failure).toContain('web/src/data/releases.ts')
    expect(failure).toContain('do not patch it from unrelated PRs')
  })

  test('skips on network failure instead of breaking the build', async () => {
    const offline = (() => Promise.reject(new Error('offline'))) as typeof fetch
    expect(await npmFreshnessFailure(offline)).toBeNull()
  })

  test('skips on a malformed registry response', async () => {
    expect(await npmFreshnessFailure(fetchReturning({}))).toBeNull()
    expect(await npmFreshnessFailure(fetchReturning({ version: 'not-semver' }))).toBeNull()
    expect(await npmFreshnessFailure(fetchReturning({ version: '01.2.3' }))).toBeNull()
    expect(await npmFreshnessFailure(fetchReturning({ version: '999.00.0' }))).toBeNull()
    expect(await npmFreshnessFailure(fetchReturning({}, false))).toBeNull()
  })
})
