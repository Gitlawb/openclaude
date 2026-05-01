import { execFile } from 'child_process'
import { readdirSync } from 'fs'
import { join, relative } from 'path'
import type { SupportedLanguage } from './types.js'

const SUPPORTED_EXTENSIONS: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
}

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.hg',
  '.svn',
  'build',
  'out',
  'coverage',
  '__pycache__',
  '.next',
  '.nuxt',
  'vendor',
  '.worktrees',
])

const EXCLUDED_FILES = new Set([
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
])

export function getLanguageForFile(filePath: string): SupportedLanguage | null {
  const ext = filePath.substring(filePath.lastIndexOf('.'))
  return SUPPORTED_EXTENSIONS[ext] ?? null
}

export function isSupportedFile(filePath: string): boolean {
  return getLanguageForFile(filePath) !== null
}

/** List files using git ls-files. Returns relative paths. */
function gitLsFiles(root: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: root, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        const files = stdout
          .split('\n')
          .map(f => f.trim())
          .filter(f => f.length > 0)
        resolve(files)
      },
    )
  })
}

/** Walk directory tree manually as fallback when git is unavailable. */
function walkDirectory(root: string, currentDir: string = root): string[] {
  const results: string[] = []
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(currentDir, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    const name = entry.name
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(name) && !name.startsWith('.')) {
        results.push(...walkDirectory(root, join(currentDir, name)))
      }
    } else if (entry.isFile()) {
      if (!EXCLUDED_FILES.has(name)) {
        results.push(relative(root, join(currentDir, name)))
      }
    }
  }
  return results
}

/**
 * Enumerate all supported source files in the repo.
 * Tries git ls-files first, falls back to manual walk.
 */
export async function getRepoFiles(root: string): Promise<string[]> {
  let files: string[]
  try {
    files = await gitLsFiles(root)
  } catch {
    files = walkDirectory(root)
  }

  return files.filter(isSupportedFile)
}
