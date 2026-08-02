import { readFileSync, writeFileSync } from 'node:fs'

export const RELEASES_TS_PATH = 'web/src/data/releases.ts'
export const CHANGELOG_PATH = 'CHANGELOG.md'
export const MANIFEST_PATH = '.release-please-manifest.json'
const RELEASE_PLEASE_DRAFT_MARKER = '  // release-please: draft\n'

export type ReleaseEntry = {
  version: string
  date: string
  theme: string
  highlights: string[]
}

export function sanitizeChangelogBullet(line: string): string {
  let sanitized = line
    .replace(/^\*\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim()

  while (true) {
    const next = sanitized.replace(/\s*\((?:#\d+|[0-9a-f]{7,40})\)\s*$/i, '').trim()
    if (next === sanitized) break
    sanitized = next
  }

  return sanitized.replace(/,\s*closes\s+#\d+$/i, '').trim()
}

export function parseChangelogSection(
  changelog: string,
  version?: string,
): { version: string; date: string; highlights: string[] } | null {
  const target = version ?? readManifestVersion()
  const sectionPattern = new RegExp(
    `^## \\[${escapeRegExp(target)}\\][^\\n]*\\((\\d{4}-\\d{2}-\\d{2})\\)\\s*$`,
    'm',
  )
  const headerMatch = changelog.match(sectionPattern)
  if (!headerMatch) return null

  const start = headerMatch.index ?? changelog.indexOf(headerMatch[0])
  const afterHeader = changelog.slice(start + headerMatch[0].length)
  const nextSection = afterHeader.search(/^## \[/m)
  const sectionBody = nextSection === -1 ? afterHeader : afterHeader.slice(0, nextSection)
  const highlights = sectionBody
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('* '))
    .map(sanitizeChangelogBullet)
    .filter(Boolean)
    .slice(0, 5)

  return { version: target, date: headerMatch[1]!, highlights }
}

export function deriveTheme(highlights: string[]): string {
  if (highlights.length === 0) return 'release highlights'
  const first = highlights[0]!
  const scopeMatch = first.match(/^([a-z0-9-]+):\s*/i)
  const theme = scopeMatch ? first.slice(scopeMatch[0].length) : first
  return theme.length > 72 ? `${theme.slice(0, 69)}…` : theme
}

export function readManifestVersion(manifest = readFileSync(MANIFEST_PATH, 'utf8')): string {
  const parsed = JSON.parse(manifest) as Record<string, string>
  const version = parsed['.']
  if (!version) throw new Error(`missing root version in ${MANIFEST_PATH}`)
  return version
}

export function readCurrentTopVersion(releasesTs: string): string | null {
  const match = releasesTs.match(
    /export const releases: Release\[\] = \[\s*(?:\/\/ release-please: draft\s*)?\{\s*version: '([^']+)'/s,
  )
  return match?.[1] ?? null
}

export function formatReleaseEntry(entry: ReleaseEntry, indent = '  '): string {
  const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  const highlightLines = entry.highlights.map(highlight => `${indent}  ${quote(highlight)},`).join('\n')
  return `${RELEASE_PLEASE_DRAFT_MARKER}${indent}{
${indent}  version: ${quote(entry.version)},
${indent}  date: ${quote(entry.date)},
${indent}  theme: ${quote(entry.theme)},
${indent}  highlights: [
${highlightLines}
${indent}  ],
${indent}},`
}

export function insertReleaseEntry(releasesTs: string, entry: ReleaseEntry): string {
  const withoutDraft = releasesTs.replace(/^  \/\/ release-please: draft\n  \{[\s\S]*?^  \},\n/m, '')
  const marker = 'export const releases: Release[] = ['
  const index = withoutDraft.indexOf(marker)
  if (index === -1) throw new Error(`could not find releases array in ${RELEASES_TS_PATH}`)

  const insertAt = index + marker.length
  return `${withoutDraft.slice(0, insertAt)}\n${formatReleaseEntry(entry)}${withoutDraft.slice(insertAt)}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type SyncResult =
  | { status: 'unchanged'; version: string; reason: string }
  | { status: 'updated'; version: string; content: string }

export function syncWebReleaseEntry(options: {
  changelog?: string
  releasesTs?: string
  manifestVersion?: string
} = {}): SyncResult {
  const version = options.manifestVersion ?? readManifestVersion()
  const releasesTs = options.releasesTs ?? readFileSync(RELEASES_TS_PATH, 'utf8')
  const currentTop = readCurrentTopVersion(releasesTs)
  if (currentTop === version && !releasesTs.includes(RELEASE_PLEASE_DRAFT_MARKER))
    return { status: 'unchanged', version, reason: 'releases.ts already lists this version first' }

  const changelog = options.changelog ?? readFileSync(CHANGELOG_PATH, 'utf8')
  const section = parseChangelogSection(changelog, version)
  if (!section) throw new Error(`no CHANGELOG.md section found for version ${version}`)
  if (section.highlights.length === 0)
    throw new Error(`CHANGELOG.md section for ${version} has no bullet highlights`)

  return {
    status: 'updated',
    version,
    content: insertReleaseEntry(releasesTs, {
      version: section.version,
      date: section.date,
      theme: deriveTheme(section.highlights),
      highlights: section.highlights,
    }),
  }
}

if (import.meta.main) {
  const result = syncWebReleaseEntry()
  if (result.status === 'unchanged') console.log(`sync-web-release-entry: ${result.reason}`)
  else if (process.argv.includes('--write')) {
    writeFileSync(RELEASES_TS_PATH, result.content)
    console.log(`sync-web-release-entry: inserted ${result.version} into ${RELEASES_TS_PATH}`)
  } else {
    console.error(`sync-web-release-entry: ${RELEASES_TS_PATH} is missing ${result.version}; run with --write`)
    process.exit(1)
  }
}
