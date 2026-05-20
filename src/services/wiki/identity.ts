import { execFileSync } from 'child_process'
import { basename } from 'path'
import { getFsImplementation } from '../../utils/fsOperations.js'

export type ProjectIdentity = {
  name: string
  /** Detected primary languages sorted by file count descending */
  languages: { name: string; fileCount: number }[]
  /** Whether the project uses npm workspaces or similar */
  isMonorepo: boolean
  /** Main/default branch name (usually "main" or "master") */
  mainBranch: string
}

/**
 * Detect primary languages in the project by counting source files.
 * Uses a sync glob-like approach (readdir + extension check) for speed.
 * Limit to 3 most common for brevity in context.
 */
function detectLanguages(cwd: string): { name: string; fileCount: number }[] {
  const fs = getFsImplementation()
  const counts: Record<string, number> = {}
  const EXTENSION_MAP: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.mjs': 'JavaScript',
    '.cjs': 'JavaScript',
    '.py': 'Python',
    '.go': 'Go',
    '.rs': 'Rust',
    '.rb': 'Ruby',
    '.java': 'Java',
    '.kt': 'Kotlin',
    '.cs': 'C#',
    '.swift': 'Swift',
    '.c': 'C',
    '.cpp': 'C++',
    '.h': 'C/C++ Header',
    '.hpp': 'C++ Header',
  }

  try {
    const entries = fs.readdirSync(cwd)
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
      const lang = EXTENSION_MAP[ext]
      if (lang) {
        counts[lang] = (counts[lang] ?? 0) + 1
      }
    }
  } catch {
    // Directory not readable — skip
  }

  return Object.entries(counts)
    .map(([name, fileCount]) => ({ name, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount)
    .slice(0, 3)
}

/**
 * Detect whether the project is a monorepo by checking for workspace config.
 * Handles npm/pnpm/yarn workspaces and bun workspaces.
 */
function detectMonorepo(cwd: string): boolean {
  const fs = getFsImplementation()
  const pkgPath = `${cwd}/package.json`
  try {
    const raw = fs.readFileSync(pkgPath, { encoding: 'utf-8' })
    const pkg = JSON.parse(raw) as Record<string, unknown>
    if (pkg.workspaces) return true
  } catch {
    // No package.json or invalid JSON
  }

  // Check for pnpm workspace
  try {
    fs.readFileSync(`${cwd}/pnpm-workspace.yaml`, { encoding: 'utf-8' })
    return true
  } catch {
    return false
  }
}

/**
 * Detect the main branch name from git.
 */
function detectMainBranch(cwd: string): string {
  try {
    const output = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd,
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as string
    return output.trim().replace('refs/remotes/origin/', '')
  } catch {
    return 'main'
  }
}

/**
 * Build a project identity fingerprint.
 */
export function getProjectIdentity(cwd: string): ProjectIdentity {
  let name = basename(cwd)

  const fs = getFsImplementation()
  try {
    const raw = fs.readFileSync(`${cwd}/package.json`, { encoding: 'utf-8' })
    const pkg = JSON.parse(raw) as { name?: string }
    if (pkg.name) {
      name = pkg.name
    }
  } catch {
    // No package.json — use directory name
  }

  return {
    name,
    languages: detectLanguages(cwd),
    isMonorepo: detectMonorepo(cwd),
    mainBranch: detectMainBranch(cwd),
  }
}
