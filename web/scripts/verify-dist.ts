// Post-build guard, run by `bun run build` after `astro build`.
// Asserts that the typed data files actually drive the rendered output:
// version propagation, navigation, and the /, /buddy/, /changelog/ routes.
// Kept as a pure function so verify-dist.test.ts can exercise it on fixtures.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { SITE } from '../src/data/site'
import { docsPages } from '../src/data/docsNav'
import { releases, releaseUrl } from '../src/data/releases'
import { heroes } from '../src/data/buddy'
import { partners, community } from '../src/data/partners'

export function verifyDist(dist: string): string[] {
  const failures: string[] = []

  function page(route: string): string {
    const file = join(dist, route.replace(/^\//, ''), 'index.html')
    if (!existsSync(file)) {
      failures.push(`missing page for route ${route}`)
      return ''
    }
    const html = readFileSync(file, 'utf8')
    if (html.trim() === '') {
      // '' is only ever returned alongside a recorded failure, so expect()
      // skipping falsy html can never silently pass a bad page.
      failures.push(`empty page for route ${route}`)
      return ''
    }
    return html
  }

  function expect(html: string, needle: string, why: string): void {
    if (html !== '' && !html.includes(needle)) failures.push(`${why}: missing ${JSON.stringify(needle)}`)
  }

  // ── version propagation (site.ts derives from the newest releases entry) ─
  const index = page('/')
  expect(index, `v${SITE.version}`, 'landing version')

  // ── navigation exposes every docsNav route, in data AND rendered output ──
  const docsIndex = page('/docs/')
  for (const p of docsPages) {
    page(p.href) // records a failure if the route didn't build
    expect(docsIndex, `href="${p.href}"`, `docs sidebar link ${p.href}`)
  }
  for (const href of ['/buddy/', '/changelog/'] as const) {
    if (!docsPages.some(p => p.href === href)) failures.push(`docsNav missing ${href}`)
    expect(index, `href="${href}"`, `landing nav link ${href}`)
  }

  // ── /changelog/: every release renders with its GitHub release URL ───────
  const changelog = page('/changelog/')
  for (const r of releases) {
    expect(changelog, `v${r.version}`, `changelog release ${r.version}`)
    expect(changelog, releaseUrl(r.version), `changelog release URL ${r.version}`)
  }
  expect(changelog, `v${SITE.version}`, 'changelog current-version pill')

  // ── /buddy/: every hero renders with its sprite ──────────────────────────
  const buddy = page('/buddy/')
  for (const h of heroes) {
    expect(buddy, `/buddy/${h.id}.svg`, `buddy sprite ${h.id}`)
    expect(buddy, h.attack, `buddy attack ${h.id}`)
    if (!existsSync(join(dist, 'buddy', `${h.id}.svg`)))
      failures.push(`missing sprite asset /buddy/${h.id}.svg`)
  }

  // ── landing: partner and community links render ──────────────────────────
  for (const p of partners) {
    expect(index, `href="${p.url}"`, `partner link ${p.name}`)
    expect(index, p.logo, `partner logo ${p.name}`)
  }
  for (const c of community) expect(index, `href="${c.url}"`, `community link ${c.name}`)

  // ── sitemap covers the new routes ────────────────────────────────────────
  const sitemapFile = join(dist, 'sitemap-0.xml')
  if (existsSync(sitemapFile)) {
    const sitemap = readFileSync(sitemapFile, 'utf8')
    for (const route of ['/buddy/', '/changelog/'])
      expect(sitemap, `${SITE.url}${route}`, `sitemap entry ${route}`)
  } else {
    failures.push('missing dist/sitemap-0.xml')
  }

  return [...new Set(failures)]
}

function newerThan(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

// With web/ standalone, releases.ts is the only version source — this is the
// guard against it silently going stale. Best-effort by design: an unreachable
// registry (offline CI, npm outage) skips the check rather than failing the
// build; only a *confirmed newer* npm release fails. A site version ahead of
// npm is allowed so a release PR can land before the publish completes.
export async function npmFreshnessFailure(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let published: string
  try {
    const res = await fetchImpl('https://registry.npmjs.org/@gitlawb/openclaude/latest', {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    published = ((await res.json()) as { version?: string }).version ?? ''
  } catch {
    return null
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(published)) return null
  if (newerThan(published, SITE.version))
    return `npm latest ${published} is newer than site version ${SITE.version} — releases.ts is stale; do not patch it from unrelated PRs (release/web process owns web/src/data/releases.ts)`
  return null
}

if (import.meta.main) {
  const failures = verifyDist(join(import.meta.dir, '..', 'dist'))
  const stale = await npmFreshnessFailure()
  if (stale) failures.push(stale)
  if (failures.length > 0) {
    console.error(`verify-dist: ${failures.length} failure(s)`)
    for (const f of failures) console.error(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log('verify-dist: ok — version, nav, buddy, changelog, partners all verified')
}
