import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, test } from 'bun:test'

const REPO_ROOT = join(import.meta.dir, '..')
const SCAN_ROOTS = ['src', 'scripts']
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
])
const FORBIDDEN_TIMEOUT_SIGNAL_RE = /AbortSignal\s*\.\s*timeout\s*\(/

type Finding = {
  path: string
  line: number
  column: number
  source: string
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot)
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry)
    const stats = statSync(absolute)
    if (stats.isDirectory()) {
      yield* walk(absolute)
      continue
    }
    if (stats.isFile() && SOURCE_EXTENSIONS.has(extensionOf(entry))) {
      yield absolute
    }
  }
}

function isAllowedDocumentationLine(line: string): boolean {
  const trimmed = line.trim()
  const isComment =
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*')

  return (
    isComment &&
    /\b(avoid|bug|Bun|clearTimeout|forbid|lazy|leak|memory|must not|instead)\b/i.test(
      trimmed,
    )
  )
}

function isAllowedTestFixtureLine(line: string): boolean {
  const trimmed = line.trim()
  const isStringOrRegexFixture =
    /["'`].*AbortSignal\s*\.\s*timeout\s*\(/.test(trimmed) ||
    /\/.*AbortSignal.*timeout.*\\?\(/.test(trimmed)

  return (
    isStringOrRegexFixture &&
    /\b(forbidden|fixture|guard|pattern|raw|regression)\b/i.test(trimmed)
  )
}

function isAllowedOccurrence(path: string, line: string): boolean {
  if (path === 'src/utils/combinedAbortSignal.ts') return true

  if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) {
    return isAllowedDocumentationLine(line) || isAllowedTestFixtureLine(line)
  }

  return isAllowedDocumentationLine(line)
}

function findRawTimeoutSignalUsages(): Finding[] {
  const findings: Finding[] = []

  for (const root of SCAN_ROOTS) {
    for (const absolute of walk(join(REPO_ROOT, root))) {
      const path = relative(REPO_ROOT, absolute).split(sep).join('/')
      const lines = readFileSync(absolute, 'utf-8').split(/\r?\n/)

      lines.forEach((source, index) => {
        const match = FORBIDDEN_TIMEOUT_SIGNAL_RE.exec(source)
        if (!match || isAllowedOccurrence(path, source)) return

        findings.push({
          path,
          line: index + 1,
          column: match.index + 1,
          source: source.trim(),
        })
      })
    }
  }

  return findings
}

describe('raw timeout signal guard', () => {
  test('source files use cleanup-safe timeout signal helpers', () => {
    const findings = findRawTimeoutSignalUsages()

    expect(
      findings.map(
        finding =>
          `${finding.path}:${finding.line}:${finding.column} ${finding.source}`,
      ),
    ).toEqual([])
  })
})
