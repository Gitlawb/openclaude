import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

import type { ManifestInfo } from '../types.js'

type ManifestDetector = {
  filename: string
  type: string // 'npm' | 'cargo' | 'python' | 'go' | 'maven' | 'ruby' | 'composer'
  language: string
  parse: (content: string, path: string) => Partial<ManifestInfo>
}

const DETECTORS: ManifestDetector[] = [
  {
    filename: 'package.json',
    type: 'npm',
    language: 'TypeScript/JavaScript',
    parse: (content) => {
      const pkg = JSON.parse(content)
      return {
        framework: detectFramework(pkg.dependencies, pkg.devDependencies),
        scripts: pkg.scripts || {},
        dependencies: { ...pkg.dependencies, ...pkg.devDependencies },
      }
    },
  },
  {
    filename: 'Cargo.toml',
    type: 'cargo',
    language: 'Rust',
    parse: (content) => {
      // Basic TOML key extraction for deps (no full parser needed)
      const deps: Record<string, string> = {}
      const depSection = content.match(/\[dependencies\]([\s\S]*?)(?:\n\[|$)/)
      if (depSection) {
        const lines = depSection[1].split('\n')
        for (const line of lines) {
          const match = line.match(/^(\S+)\s*=\s*"([^"]+)"/)
          if (match) {
            deps[match[1]] = match[2]
          }
        }
      }
      return Object.keys(deps).length > 0 ? { dependencies: deps } : {}
    },
  },
  {
    filename: 'pyproject.toml',
    type: 'python',
    language: 'Python',
    parse: (content) => {
      // Basic extraction for project name and deps
      const deps: Record<string, string> = {}
      const depsSection = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)
      if (depsSection) {
        const items = depsSection[1].match(/"([^"]+)"/g)
        if (items) {
          for (const item of items) {
            const name = item.replace(/"/g, '').split(/[>=<~!]/)[0].trim()
            deps[name] = item.replace(/"/g, '')
          }
        }
      }
      return Object.keys(deps).length > 0 ? { dependencies: deps } : {}
    },
  },
  {
    filename: 'go.mod',
    type: 'go',
    language: 'Go',
    parse: (content) => {
      // Extract module name and require blocks
      const deps: Record<string, string> = {}
      const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/)
      if (requireBlock) {
        const lines = requireBlock[1].split('\n')
        for (const line of lines) {
          const match = line.trim().match(/^(\S+)\s+(\S+)/)
          if (match) {
            deps[match[1]] = match[2]
          }
        }
      }
      return Object.keys(deps).length > 0 ? { dependencies: deps } : {}
    },
  },
  {
    filename: 'pom.xml',
    type: 'maven',
    language: 'Java',
    parse: () => ({}),
  },
  {
    filename: 'Gemfile',
    type: 'ruby',
    language: 'Ruby',
    parse: () => ({}),
  },
  {
    filename: 'composer.json',
    type: 'composer',
    language: 'PHP',
    parse: (content) => {
      const pkg = JSON.parse(content)
      return {
        dependencies: { ...pkg.require, ...pkg['require-dev'] },
      }
    },
  },
]

/**
 * Detect framework from npm dependencies
 */
function detectFramework(
  deps?: Record<string, string>,
  devDeps?: Record<string, string>,
): string | undefined {
  const all = { ...deps, ...devDeps }
  if (all['next']) return 'Next.js'
  if (all['@nestjs/core']) return 'NestJS'
  if (all['express']) return 'Express'
  if (all['react'] && !all['next']) return 'React'
  if (all['vue']) return 'Vue'
  if (all['@angular/core']) return 'Angular'
  if (all['svelte']) return 'Svelte'
  if (all['fastify']) return 'Fastify'
  if (all['hono']) return 'Hono'
  return undefined
}

/**
 * Scan project root (and one level deep for monorepos) for manifest files.
 * Returns all detected manifests with extracted metadata.
 */
export function detectManifests(projectRoot: string): ManifestInfo[] {
  const results: ManifestInfo[] = []

  // 1. Check root directory for each detector
  for (const detector of DETECTORS) {
    const filePath = join(projectRoot, detector.filename)
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8')
        const parsed = detector.parse(content, filePath)
        results.push({
          path: relative(projectRoot, filePath),
          type: detector.type,
          language: detector.language,
          ...parsed,
        })
      } catch {
        // If parsing fails, still record the manifest with basic info
        results.push({
          path: relative(projectRoot, filePath),
          type: detector.type,
          language: detector.language,
        })
      }
    }
  }

  // 2. Check one level of subdirectories (for monorepo packages)
  //    Only scan dirs that look like packages (not node_modules, .git, dist, etc.)
  const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'target',
    '.next',
    '.nuxt',
    'vendor',
    '__pycache__',
    '.venv',
    'venv',
  ])

  try {
    const entries = readdirSync(projectRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name))
        continue
      const subdir = join(projectRoot, entry.name)
      for (const detector of DETECTORS) {
        const filePath = join(subdir, detector.filename)
        if (existsSync(filePath)) {
          try {
            const content = readFileSync(filePath, 'utf-8')
            const parsed = detector.parse(content, filePath)
            results.push({
              path: relative(projectRoot, filePath),
              type: detector.type,
              language: detector.language,
              ...parsed,
            })
          } catch {
            results.push({
              path: relative(projectRoot, filePath),
              type: detector.type,
              language: detector.language,
            })
          }
        }
      }
    }
  } catch {
    // If directory reading fails, return what we have
  }

  return results
}
