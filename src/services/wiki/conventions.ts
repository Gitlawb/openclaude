import { createHash } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { getWikiPaths } from './paths.js'
import { getProjectIdentity } from './identity.js'
import type { ConventionResult } from './types.js'

// ─── Config File Detection ────────────────────────────────────────

type Scanner = {
  /** Relative file path(s) to check. First existing one wins. */
  files: string[]
  /** Extract conventions from the file content. Returns markdown bullet lines. */
  extract: (content: string, filePath: string) => string[]
  /** Human-readable section heading */
  label: string
}

async function tryRead(
  cwd: string,
  ...paths: string[]
): Promise<{ content: string; filePath: string } | null> {
  for (const p of paths) {
    try {
      const content = await readFile(`${cwd}/${p}`, { encoding: 'utf-8' })
      return { content, filePath: p }
    } catch {
      continue
    }
  }
  return null
}

function extractPackageManager(content: string): string[] {
  try {
    const pkg = JSON.parse(content) as {
      packageManager?: string
      scripts?: Record<string, string>
      devDependencies?: Record<string, string>
      dependencies?: Record<string, string>
    }
    const lines: string[] = []

    // Package manager detection
    if (pkg.packageManager) {
      lines.push(`- Package manager: **${pkg.packageManager}**`)
    } else {
      // Infer from lock file or common patterns
      lines.push('- Package manager: (not explicitly declared)')
    }

    // Test framework
    const allDeps = { ...pkg.devDependencies, ...pkg.dependencies }
    const testFrameworks: string[] = []
    if (allDeps?.vitest) testFrameworks.push('vitest')
    if (allDeps?.jest) testFrameworks.push('jest')
    if (allDeps?.mocha) testFrameworks.push('mocha')
    if (allDeps?.ava) testFrameworks.push('ava')
    if (allDeps?.tape) testFrameworks.push('tape')
    if (allDeps?.uvu) testFrameworks.push('uvu')
    if (testFrameworks.length > 0) {
      lines.push(`- Test framework: **${testFrameworks.join(', ')}**`)
    }

    // Test script
    if (pkg.scripts?.test) {
      lines.push(`- Test command: \`${pkg.scripts.test}\``)
    }

    // Build script
    if (pkg.scripts?.build) {
      lines.push(`- Build command: \`${pkg.scripts.build}\``)
    }

    // TypeScript
    if (allDeps?.typescript) {
      lines.push('- TypeScript: **detected** (in devDependencies)')
    }

    // Lint
    if (pkg.scripts?.lint) {
      lines.push(`- Lint command: \`${pkg.scripts.lint}\``)
    }
    if (pkg.scripts?.['lint:fix']) {
      lines.push(`- Lint fix command: \`${pkg.scripts['lint:fix']}\``)
    }

    // Format
    if (pkg.scripts?.format) {
      lines.push(`- Format command: \`${pkg.scripts.format}\``)
    }

    // Typecheck
    if (pkg.scripts?.typecheck) {
      lines.push(`- Typecheck command: \`${pkg.scripts.typecheck}\``)
    }

    return lines
  } catch {
    return ['- (unable to parse package.json)']
  }
}

function extractTSConfig(content: string): string[] {
  try {
    const cfg = JSON.parse(content) as {
      compilerOptions?: {
        target?: string
        module?: string
        strict?: boolean
        jsx?: string
        moduleResolution?: string
        outDir?: string
      }
    }
    const opts = cfg.compilerOptions
    if (!opts) return ['- (no compilerOptions)']
    const lines: string[] = []
    if (opts.target) lines.push(`- Target: **${opts.target}**`)
    if (opts.module) lines.push(`- Module: **${opts.module}**`)
    if (opts.moduleResolution)
      lines.push(`- Module resolution: **${opts.moduleResolution}**`)
    lines.push(`- Strict mode: **${opts.strict === false ? 'off' : 'on'}**`)
    if (opts.jsx) lines.push(`- JSX: **${opts.jsx}**`)
    if (opts.outDir) lines.push(`- Output: **${opts.outDir}**`)
    return lines
  } catch {
    return ['- (unable to parse tsconfig.json)']
  }
}

function extractESLintConfig(content: string, filePath: string): string[] {
  const lines: string[] = []
  try {
    // ESLint 9 flat config
    if (filePath.endsWith('.mjs') || content.includes('export default')) {
      const pluginMatch = content.match(/from\s+['"](@[^'"]+\/eslint-plugin[^'"]*|eslint-plugin-[^'"]+)['"]/g)
      if (pluginMatch) {
        const plugins = [...new Set(pluginMatch.map(m => m.replace(/from\s+['"]/, '').replace(/['"]$/, '')))]
        lines.push(`- Plugins: ${plugins.join(', ')}`)
      }
      if (content.includes('typescript-eslint') || content.includes('@typescript-eslint')) {
        lines.push('- TypeScript ESLint: **enabled**')
      }
    } else {
      // Legacy .eslintrc
      try {
        const cfg = JSON.parse(content) as {
          extends?: string | string[]
          plugins?: string[]
          parser?: string
        }
        if (cfg.extends) {
          const exts = Array.isArray(cfg.extends) ? cfg.extends : [cfg.extends]
          if (exts.some(e => e.includes('typescript'))) {
            lines.push('- TypeScript ESLint: **enabled**')
          }
        }
        if (cfg.plugins?.length) {
          lines.push(`- Plugins: ${cfg.plugins.join(', ')}`)
        }
      } catch {
        // Raw JS config file — skip structured parsing
      }
    }
  } catch {
    // ignore
  }
  if (lines.length === 0) {
    lines.push('- ESLint: **detected** (custom config)')
  }
  return lines
}

function extractPrettierConfig(content: string): string[] {
  const lines: string[] = []
  try {
    const cfg = JSON.parse(content) as {
      semi?: boolean
      singleQuote?: boolean
      tabWidth?: number
      useTabs?: boolean
      trailingComma?: string
      printWidth?: number
    }
    if (cfg.semi !== undefined) lines.push(`- Semicolons: **${cfg.semi ? 'yes' : 'no'}**`)
    if (cfg.singleQuote !== undefined) lines.push(`- Quotes: **${cfg.singleQuote ? 'single' : 'double'}**`)
    if (cfg.tabWidth !== undefined) lines.push(`- Tab width: **${cfg.tabWidth}**`)
    if (cfg.useTabs !== undefined) lines.push(`- Indent: **${cfg.useTabs ? 'tabs' : 'spaces'}**`)
    if (cfg.trailingComma) lines.push(`- Trailing commas: **${cfg.trailingComma}**`)
    if (cfg.printWidth) lines.push(`- Print width: **${cfg.printWidth}**`)
  } catch {
    lines.push('- Prettier: **detected** (custom config)')
  }
  return lines
}

function extractDockerfile(content: string): string[] {
  const lines: string[] = []
  const baseImage = content.match(/FROM\s+(\S+)/i)
  if (baseImage) lines.push(`- Base image: \`${baseImage[1]}\``)
  if (content.match(/EXPOSE\s+\d+/i)) lines.push('- Container exposes ports')
  if (content.match(/MULTI-STAGE/i) || (content.match(/FROM\s+/gi)?.length ?? 0) > 1) {
    lines.push('- Multi-stage build: **yes**')
  }
  return lines
}

const SCANNERS: Scanner[] = [
  {
    label: 'Package Manager & Scripts',
    files: ['package.json'],
    extract: content => extractPackageManager(content),
  },
  {
    label: 'TypeScript Config',
    files: ['tsconfig.json', 'tsconfig.app.json'],
    extract: content => extractTSConfig(content),
  },
  {
    label: 'ESLint Config',
    files: [
      'eslint.config.mjs',
      'eslint.config.js',
      '.eslintrc.json',
      '.eslintrc.js',
      '.eslintrc.yml',
      '.eslintrc.yaml',
    ],
    extract: (content, filePath) => extractESLintConfig(content, filePath),
  },
  {
    label: 'Prettier Config',
    files: ['.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.yaml', '.prettierrc.yml', 'prettier.config.js'],
    extract: content => extractPrettierConfig(content),
  },
  {
    label: 'Docker',
    files: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'],
    extract: content => extractDockerfile(content),
  },
  {
    label: 'CI/CD',
    files: ['.github/workflows/pr-checks.yml', '.github/workflows/ci.yml', '.github/workflows/test.yml'],
    extract: content => {
      const lines: string[] = []
      const name = content.match(/name:\s*(.+)/)
      if (name) lines.push(`- Pipeline: **${name[1]}**`)
      if (content.includes('on:')) lines.push('- Trigger: CI workflow defined')
      return lines.length > 0 ? lines : ['- CI: **detected** (GitHub Actions)']
    },
  },
  {
    label: 'Lockfile',
    files: ['bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'],
    extract: (_, filePath) => {
      const lockMap: Record<string, string> = {
        'bun.lock': 'bun',
        'bun.lockb': 'bun',
        'package-lock.json': 'npm',
        'yarn.lock': 'yarn',
        'pnpm-lock.yaml': 'pnpm',
      }
      const pm = Object.entries(lockMap).find(([key]) => filePath.endsWith(key))
      return pm ? [`- Lockfile: **${pm[1]}** (${filePath})`] : []
    },
  },
]

// ─── Fingerprint ──────────────────────────────────────────────────

function computeFingerprint(results: { label: string; lines: string[] }[]): string {
  const hash = createHash('sha256')
  for (const r of results) {
    hash.update(r.label)
    for (const line of r.lines) {
      hash.update(line)
    }
  }
  return hash.digest('hex').slice(0, 16)
}

// ─── Main Scan ────────────────────────────────────────────────────

export type ScanResult = {
  sections: { label: string; lines: string[] }[]
  markdown: string
  fingerprint: string
  identity: ReturnType<typeof getProjectIdentity>
}

/**
 * Scan the project for conventions by reading config files.
 * Returns structured results and a markdown summary.
 */
export async function scanProjectConventions(cwd: string): Promise<ScanResult> {
  const identity = getProjectIdentity(cwd)
  const sections: { label: string; lines: string[] }[] = []

  for (const scanner of SCANNERS) {
    const file = await tryRead(cwd, ...scanner.files)
    if (file) {
      const lines = scanner.extract(file.content, file.filePath)
      if (lines.length > 0) {
        sections.push({ label: scanner.label, lines })
      }
    }
  }

  const markdown = formatConventions(identity, sections)
  const fingerprint = computeFingerprint(sections)

  return { sections, markdown, fingerprint, identity }
}

function formatConventions(
  identity: ReturnType<typeof getProjectIdentity>,
  sections: { label: string; lines: string[] }[],
): string {
  const parts: string[] = [
    '# Project Conventions',
    '',
    `Auto-detected conventions for **${identity.name}**.`,
    `Last scanned: ${new Date().toISOString()}`,
    '',
  ]

  // Language summary
  if (identity.languages.length > 0) {
    parts.push(
      '## Languages',
      '',
      ...identity.languages.map(l => `- **${l.name}**: ${l.fileCount} files`),
      '',
    )
  }

  // Monorepo
  if (identity.isMonorepo) {
    parts.push('', '> **Monorepo**: workspaces detected.', '')
  }

  // Git
  parts.push('', '## Git', '', `- Default branch: **${identity.mainBranch}**`, '')

  // Detected conventions
  for (const section of sections) {
    parts.push(`## ${section.label}`, '', ...section.lines, '')
  }

  parts.push('---', '', '_This page is auto-generated. Run `/wiki scan` to refresh._', '')

  return parts.join('\n')
}

// ─── Cache ─────────────────────────────────────────────────────────

type CacheEntry = {
  fingerprint: string
  scannedAt: string
}

async function readCache(cwd: string): Promise<CacheEntry | null> {
  const { conventionsCacheFile } = getWikiPaths(cwd)
  try {
    const raw = await readFile(conventionsCacheFile, { encoding: 'utf-8' })
    return JSON.parse(raw) as CacheEntry
  } catch {
    return null
  }
}

async function writeCache(cwd: string, fingerprint: string): Promise<void> {
  const { conventionsCacheFile } = getWikiPaths(cwd)
  const entry: CacheEntry = { fingerprint, scannedAt: new Date().toISOString() }
  await writeFile(conventionsCacheFile, JSON.stringify(entry, null, 2), { encoding: 'utf-8' })
}

/**
 * Scan and save conventions to the wiki if they've changed.
 * Returns the convention result if updated, or null if unchanged.
 */
export async function scanAndSaveConventions(cwd: string): Promise<ConventionResult | null> {
  const scan = await scanProjectConventions(cwd)
  const cached = await readCache(cwd)

  if (cached?.fingerprint === scan.fingerprint) {
    return null // No change
  }

  // Write the convention page to the wiki
  const { conventionsFile } = getWikiPaths(cwd)
  try {
    await writeFile(conventionsFile, scan.markdown, { encoding: 'utf-8' })
  } catch {
    // Wiki may not be initialized — silently skip
    return null
  }

  await writeCache(cwd, scan.fingerprint)

  return {
    markdown: scan.markdown,
    fingerprint: scan.fingerprint,
    scannedAt: new Date().toISOString(),
  }
}

/**
 * Force re-scan and return the result without caching.
 */
export async function forceScanConventions(cwd: string): Promise<ConventionResult> {
  const scan = await scanProjectConventions(cwd)
  const { conventionsFile } = getWikiPaths(cwd)

  try {
    await writeFile(conventionsFile, scan.markdown, { encoding: 'utf-8' })
  } catch {
    // Wiki not initialized — result still returned
  }

  await writeCache(cwd, scan.fingerprint)

  return {
    markdown: scan.markdown,
    fingerprint: scan.fingerprint,
    scannedAt: new Date().toISOString(),
  }
}
