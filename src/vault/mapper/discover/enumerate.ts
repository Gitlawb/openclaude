import { readdirSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { SKIP_DIRS } from '../../indexer/index.js'
import type { ModuleCandidate } from '../types.js'

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])

/**
 * Walk a source root and return one ModuleCandidate per folder
 * that contains at least one TS/JS source file.
 */
export function enumerateModules(sourceRoot: string, repoRoot: string): ModuleCandidate[] {
  const candidates: ModuleCandidate[] = []
  walk(sourceRoot, sourceRoot, repoRoot, candidates)
  candidates.sort((a, b) => a.slug.localeCompare(b.slug))
  return candidates
}

function walk(
  dir: string,
  sourceRoot: string,
  repoRoot: string,
  out: ModuleCandidate[],
) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  const sourceFiles: string[] = []
  const subdirs: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue

    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      subdirs.push(full)
    } else if (SOURCE_EXTS.has(extname(entry.name).toLowerCase())) {
      sourceFiles.push(full)
    }
  }

  if (sourceFiles.length > 0) {
    const rel = relative(sourceRoot, dir)
    const slug = rel ? toKebab(rel) : toKebab(relative(repoRoot, dir))
    const hasTs = sourceFiles.some(f => {
      const ext = extname(f).toLowerCase()
      return ext === '.ts' || ext === '.tsx'
    })

    out.push({
      slug,
      sourcePath: dir,
      files: sourceFiles.sort(),
      language: hasTs ? 'typescript' : 'javascript',
    })
  }

  for (const sub of subdirs) {
    walk(sub, sourceRoot, repoRoot, out)
  }
}

function toKebab(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')  // normalize Windows separators
    .replace(/\//g, '-')  // path segments become dashes
    .toLowerCase()
}
