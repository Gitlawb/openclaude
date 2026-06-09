import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { expect, test } from 'bun:test'

const REPO_ROOT = join(import.meta.dir, '..')
const SOURCE_ROOTS = ['src', 'scripts']
const BANNED_PATTERNS = [
  /\bisAntEmployee\b/,
  /\bIS_ANT_EMPLOYEE\b/,
  /utils\/buildConfig/,
] as const
const REMOVED_FILES = [
  'src/utils/buildConfig.ts',
  'src/utils/buildConfig.test.ts',
] as const

function collectFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      files.push(...collectFiles(fullPath))
      continue
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath)
    }
  }
  return files
}

test('open build source does not reintroduce Ant employee gate helpers', () => {
  const offenders: string[] = []

  for (const filePath of REMOVED_FILES) {
    expect(existsSync(join(REPO_ROOT, filePath))).toBe(false)
  }

  for (const root of SOURCE_ROOTS) {
    for (const filePath of collectFiles(join(REPO_ROOT, root))) {
      if (filePath === import.meta.path) continue
      const contents = readFileSync(filePath, 'utf8')
      if (BANNED_PATTERNS.some(pattern => pattern.test(contents))) {
        offenders.push(relative(REPO_ROOT, filePath))
      }
    }
  }

  expect(offenders).toEqual([])
})

test('initial plan messages do not seed pending plan verification state', () => {
  const replSource = readFileSync(join(REPO_ROOT, 'src/screens/REPL.tsx'), 'utf8')
  const initialMessageHandlerStart = replSource.indexOf(
    'async function processInitialMessage',
  )
  const initialMessageHandlerEnd = replSource.indexOf(
    '// Create file history snapshot',
    initialMessageHandlerStart,
  )

  expect(initialMessageHandlerStart).toBeGreaterThan(-1)
  expect(initialMessageHandlerEnd).toBeGreaterThan(initialMessageHandlerStart)
  expect(
    replSource.slice(initialMessageHandlerStart, initialMessageHandlerEnd),
  ).not.toContain('pendingPlanVerification')
})
