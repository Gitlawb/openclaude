import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import type { IndexResult } from '../../types.js'

/**
 * Resolve the canonical source root(s) for a repo.
 *
 * Priority: tsconfig.json rootDir/include → src/ → lib/ → repo root.
 * For monorepos with workspaces, returns one root per resolved workspace.
 */
export function resolveSourceRoot(repoRoot: string, indexResult: IndexResult): string[] {
  const abs = resolve(repoRoot)

  if (indexResult.structure.isMonorepo && indexResult.structure.workspaces?.length) {
    return resolveMonorepoRoots(abs, indexResult.structure.workspaces)
  }

  const single = resolveSingleRoot(abs)
  return [single]
}

function resolveSingleRoot(repoRoot: string): string {
  const fromTsconfig = readTsconfigRoot(repoRoot)
  if (fromTsconfig) {
    const candidate = resolve(repoRoot, fromTsconfig)
    if (existsSync(candidate)) return candidate
  }

  if (existsSync(join(repoRoot, 'src'))) return join(repoRoot, 'src')
  if (existsSync(join(repoRoot, 'lib'))) return join(repoRoot, 'lib')
  return repoRoot
}

function readTsconfigRoot(repoRoot: string): string | null {
  const tsconfigPath = join(repoRoot, 'tsconfig.json')
  if (!existsSync(tsconfigPath)) return null

  try {
    const raw = readFileSync(tsconfigPath, 'utf-8')
    const tsconfig = JSON.parse(raw)

    // Prefer rootDir
    if (tsconfig.compilerOptions?.rootDir) {
      return tsconfig.compilerOptions.rootDir
    }

    // Fall back to first include entry (strip glob suffix)
    if (Array.isArray(tsconfig.include) && tsconfig.include.length > 0) {
      const first = tsconfig.include[0] as string
      // "src/**/*" → "src", "src" → "src"
      const stripped = first.replace(/\/?\*\*?\/?\*?$/, '')
      if (stripped) return stripped
    }

    return null
  } catch {
    return null
  }
}

function resolveMonorepoRoots(repoRoot: string, workspaceGlobs: string[]): string[] {
  const roots: string[] = []

  for (const glob of workspaceGlobs) {
    // Simple glob expansion: "packages/*" → list dirs matching packages/
    if (glob.endsWith('/*') || glob.endsWith('/**/')) {
      const base = glob.replace(/\/?\*\*?\/?$/, '')
      const baseDir = join(repoRoot, base)
      if (!existsSync(baseDir)) continue

      try {
        const entries = readdirSync(baseDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue
          const wsRoot = join(baseDir, entry.name)
          roots.push(resolveSingleRoot(wsRoot))
        }
      } catch { /* permission error */ }
    } else {
      // Exact path: "apps/web"
      const wsRoot = join(repoRoot, glob)
      if (existsSync(wsRoot)) {
        roots.push(resolveSingleRoot(wsRoot))
      }
    }
  }

  // If no workspaces resolved, fall back to single root
  if (roots.length === 0) {
    return [resolveSingleRoot(repoRoot)]
  }

  return roots
}
