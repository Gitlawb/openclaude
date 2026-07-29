// Post-build guard, run by `bun run build` after `astro build`.
// Asserts that the typed data files actually drive the rendered output:
// version propagation, navigation, and the /, /buddy/, /changelog/ routes.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { SITE } from '../src/data/site'
import { docsPages } from '../src/data/docsNav'
import { releases, releaseUrl } from '../src/data/releases'
import { heroes } from '../src/data/buddy'
import { partners, community } from '../src/data/partners'

const dist = join(import.meta.dir, '..', 'dist')
const failures: string[] = []

function page(route: string): string {
  const file = join(dist, route.replace(/^\//, ''), 'index.html')
  if (!existsSync(file)) {
    failures.push(`missing page for route ${route}`)
    return ''
  }
  return readFileSync(file, 'utf8')
}

function expect(html: string, needle: string, why: string): void {
  if (html && !html.includes(needle)) failures.push(`${why}: missing ${JSON.stringify(needle)}`)
}

// ── version propagation (site.ts imports the root package.json) ──────────
const rootPkg = JSON.parse(
  readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8'),
) as { version: string }
if (SITE.version !== rootPkg.version)
  failures.push(`SITE.version ${SITE.version} != root package.json ${rootPkg.version}`)

const index = page('/')
expect(index, `v${rootPkg.version}`, 'landing version')

// ── navigation exposes every docsNav route, including /buddy/ and /changelog/ ──
for (const p of docsPages) page(p.href) // records a failure if the route didn't build
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
expect(changelog, `v${rootPkg.version}`, 'changelog current-version pill')

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

const unique = [...new Set(failures)]
if (unique.length > 0) {
  console.error(`verify-dist: ${unique.length} failure(s)`)
  for (const f of unique) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('verify-dist: ok — version, nav, buddy, changelog, partners all verified')
