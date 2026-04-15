import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, extname } from 'path'
import { execSync } from 'child_process'
import type { IndexResult, GitInfo, StructureInfo, TestingInfo, DocsInfo } from '../types.js'
import { detectManifests } from './manifests.js'

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '.next', '.nuxt',
  'vendor', '__pycache__', '.venv', 'venv', 'coverage', '.cache',
  '.turbo', '.output', '.svelte-kit',
])

const LARGE_REPO_THRESHOLD = 10_000

/**
 * Count files in the project (respecting skip dirs).
 * Stops counting at LARGE_REPO_THRESHOLD + 1 for efficiency.
 */
export function countFiles(dir: string, maxDepth: number = 10): { count: number; isLarge: boolean } {
  let count = 0
  function walk(currentDir: string, depth: number) {
    if (depth > maxDepth || count > LARGE_REPO_THRESHOLD) return
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
        if (entry.isDirectory()) {
          walk(join(currentDir, entry.name), depth + 1)
        } else {
          count++
        }
        if (count > LARGE_REPO_THRESHOLD) return
      }
    } catch { /* permission errors, etc */ }
  }
  walk(dir, 0)
  return { count, isLarge: count > LARGE_REPO_THRESHOLD }
}

/**
 * Detect git repository info.
 */
function detectGit(projectRoot: string): GitInfo | null {
  if (!existsSync(join(projectRoot, '.git'))) return null
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim()
    const isDirty = execSync('git status --porcelain', { cwd: projectRoot, encoding: 'utf-8' }).trim().length > 0
    let remoteUrl: string | null = null
    try {
      remoteUrl = execSync('git remote get-url origin', { cwd: projectRoot, encoding: 'utf-8' }).trim()
    } catch { /* no remote */ }
    return { remoteUrl, branch, isDirty }
  } catch {
    return null
  }
}

/**
 * Detect project structure.
 */
function detectStructure(projectRoot: string, manifests: import('../types.js').ManifestInfo[]): StructureInfo {
  const topLevelDirs: string[] = []
  try {
    const entries = readdirSync(projectRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) {
        topLevelDirs.push(entry.name)
      }
    }
  } catch { /* */ }

  // Detect monorepo via workspaces in root package.json
  let isMonorepo = false
  let workspaces: string[] | undefined
  const rootPkg = manifests.find(m => m.type === 'npm' && m.path === 'package.json')
  if (rootPkg) {
    try {
      const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
      if (pkg.workspaces) {
        isMonorepo = true
        workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages || []
      }
    } catch { /* */ }
  }
  // Also monorepo if multiple manifests of same type found
  if (!isMonorepo) {
    const typeCounts = new Map<string, number>()
    for (const m of manifests) {
      typeCounts.set(m.type, (typeCounts.get(m.type) || 0) + 1)
    }
    for (const count of typeCounts.values()) {
      if (count > 1) { isMonorepo = true; break }
    }
  }

  // Detect entry points
  const entryPoints: string[] = []
  const ENTRY_CANDIDATES = ['src/index.ts', 'src/index.js', 'src/main.ts', 'src/main.tsx', 'src/app.ts', 'src/app.tsx', 'index.ts', 'index.js', 'main.ts', 'main.go', 'src/main.rs', 'app.py', 'main.py']
  for (const candidate of ENTRY_CANDIDATES) {
    if (existsSync(join(projectRoot, candidate))) {
      entryPoints.push(candidate)
    }
  }

  return { isMonorepo, topLevelDirs: topLevelDirs.sort(), entryPoints, workspaces }
}

/**
 * Detect testing setup from manifests and file system.
 */
function detectTesting(projectRoot: string, manifests: import('../types.js').ManifestInfo[]): TestingInfo {
  const testDirs: string[] = []
  const testCommands: string[] = []
  let framework: string | undefined

  // Check common test directories
  for (const dir of ['test', 'tests', '__tests__', 'spec', 'specs', 'src']) {
    if (existsSync(join(projectRoot, dir))) {
      // Check if directory actually contains test files
      try {
        const hasTests = readdirSync(join(projectRoot, dir), { recursive: false }).some(
          f => typeof f === 'string' && (f.includes('.test.') || f.includes('.spec.') || f.includes('_test.'))
        )
        // For src/, always include since tests are often co-located
        if (hasTests || dir === 'src') {
          testDirs.push(dir)
        }
      } catch { /* */ }
    }
  }

  // Extract test commands from npm scripts
  for (const manifest of manifests) {
    if (manifest.scripts) {
      if (manifest.scripts.test) testCommands.push(manifest.scripts.test)
      if (manifest.scripts['test:unit']) testCommands.push(manifest.scripts['test:unit'])
      if (manifest.scripts['test:e2e']) testCommands.push(manifest.scripts['test:e2e'])
    }
    // Detect framework from deps
    if (manifest.dependencies) {
      if (manifest.dependencies['jest'] || manifest.dependencies['@jest/core']) framework = 'Jest'
      else if (manifest.dependencies['vitest']) framework = 'Vitest'
      else if (manifest.dependencies['mocha']) framework = 'Mocha'
      else if (manifest.dependencies['ava']) framework = 'AVA'
      // Bun has built-in test runner — detect from scripts
      else if (manifest.scripts?.test?.includes('bun test')) framework = 'Bun'
    }
  }

  // Check for coverage config
  let coverageConfig: string | undefined
  for (const file of ['.nycrc', '.nycrc.json', 'jest.config.js', 'jest.config.ts', 'vitest.config.ts']) {
    if (existsSync(join(projectRoot, file))) {
      coverageConfig = file
      break
    }
  }

  return { framework, testDirs, testCommands, coverageConfig }
}

/**
 * Detect documentation files.
 */
function detectDocs(projectRoot: string): DocsInfo {
  const readmeCandidates = ['README.md', 'readme.md', 'Readme.md', 'README.rst', 'README.txt', 'README']
  let readmePath: string | undefined
  let readmeFirstParagraph: string | undefined

  for (const candidate of readmeCandidates) {
    if (existsSync(join(projectRoot, candidate))) {
      readmePath = candidate
      try {
        const content = readFileSync(join(projectRoot, candidate), 'utf-8')
        // Extract first non-heading, non-empty paragraph
        const lines = content.split('\n')
        const paragraphLines: string[] = []
        let foundContent = false
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('![') || trimmed.startsWith('<!--')) {
            if (foundContent && paragraphLines.length > 0) break
            continue
          }
          foundContent = true
          paragraphLines.push(trimmed)
        }
        if (paragraphLines.length > 0) {
          readmeFirstParagraph = paragraphLines.join(' ').slice(0, 500)
        }
      } catch { /* */ }
      break
    }
  }

  return {
    hasReadme: !!readmePath,
    readmePath,
    readmeFirstParagraph,
    hasDocsDir: existsSync(join(projectRoot, 'docs')),
    hasExistingClaudeMd: existsSync(join(projectRoot, 'CLAUDE.md')),
  }
}

/**
 * Extract aggregated commands from all manifests.
 */
function extractCommands(manifests: import('../types.js').ManifestInfo[]): IndexResult['commands'] {
  const commands: IndexResult['commands'] = {}
  // Prefer root manifest, fall back to first manifest with scripts
  const rootManifest = manifests.find(m => m.path === 'package.json' || m.path === 'Makefile')
  const manifestsWithScripts = rootManifest?.scripts ? [rootManifest, ...manifests.filter(m => m !== rootManifest)] : manifests

  for (const manifest of manifestsWithScripts) {
    if (!manifest.scripts) continue
    for (const [key, value] of Object.entries(manifest.scripts)) {
      // Map common script names to command categories
      if (!commands.build && (key === 'build' || key === 'compile')) commands.build = value
      if (!commands.test && key === 'test') commands.test = value
      if (!commands.lint && (key === 'lint' || key === 'check')) commands.lint = value
      if (!commands.dev && (key === 'dev' || key === 'start' || key === 'serve')) commands.dev = value
      // Store any other scripts too
      if (!commands[key]) commands[key] = value
    }
  }

  return commands
}

/**
 * Derive languages from manifests and file extensions.
 */
function deriveLanguages(projectRoot: string, manifests: import('../types.js').ManifestInfo[], isLargeRepo: boolean): { languages: string[], primaryLanguage: string | null } {
  // Start with manifest languages
  const langSet = new Set<string>()
  for (const m of manifests) {
    langSet.add(m.language)
  }

  // Scan file extensions (top-level src/ only for large repos, full walk otherwise)
  const extCounts = new Map<string, number>()
  const scanDir = isLargeRepo ? join(projectRoot, 'src') : projectRoot
  if (existsSync(scanDir)) {
    function walkForExts(dir: string, depth: number) {
      if (depth > (isLargeRepo ? 2 : 4)) return
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
          if (entry.isDirectory()) {
            walkForExts(join(dir, entry.name), depth + 1)
          } else {
            const ext = extname(entry.name).toLowerCase()
            if (ext) extCounts.set(ext, (extCounts.get(ext) || 0) + 1)
          }
        }
      } catch { /* */ }
    }
    walkForExts(scanDir, 0)
  }

  // Map extensions to languages
  const EXT_MAP: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
    '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin',
    '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.cpp': 'C++', '.c': 'C',
    '.swift': 'Swift', '.dart': 'Dart', '.zig': 'Zig', '.ex': 'Elixir', '.exs': 'Elixir',
  }
  for (const [ext, count] of extCounts) {
    if (EXT_MAP[ext] && count >= 3) langSet.add(EXT_MAP[ext])
  }

  const languages = Array.from(langSet)

  // Primary language: most files from extension scan, or first manifest language
  let primaryLanguage: string | null = null
  if (extCounts.size > 0) {
    let maxCount = 0
    let maxExt = ''
    for (const [ext, count] of extCounts) {
      if (EXT_MAP[ext] && count > maxCount) { maxCount = count; maxExt = ext }
    }
    if (maxExt) primaryLanguage = EXT_MAP[maxExt]
  }
  if (!primaryLanguage && languages.length > 0) primaryLanguage = languages[0]

  return { languages, primaryLanguage }
}

/**
 * Index a codebase and produce a complete IndexResult.
 */
export async function indexCodebase(projectRoot: string): Promise<IndexResult> {
  const git = detectGit(projectRoot)
  const manifests = detectManifests(projectRoot)
  const { count: fileCount, isLarge: isLargeRepo } = countFiles(projectRoot)
  const structure = detectStructure(projectRoot, manifests)
  const testing = detectTesting(projectRoot, manifests)
  const docs = detectDocs(projectRoot)
  const commands = extractCommands(manifests)
  const { languages, primaryLanguage } = deriveLanguages(projectRoot, manifests, isLargeRepo)

  return {
    git,
    languages,
    primaryLanguage,
    manifests,
    structure,
    testing,
    docs,
    commands,
    fileCount,
    isLargeRepo,
  }
}
