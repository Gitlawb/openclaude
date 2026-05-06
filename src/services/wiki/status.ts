import { readFile, readdir, stat } from 'fs/promises'
import { getWikiPaths } from './paths.js'
import type { WikiStatus } from './types.js'

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  if (!(await pathExists(dir))) {
    return []
  }

  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath)
    }
  }

  return files
}

async function getLastUpdatedAt(pathsToCheck: string[]): Promise<string | null> {
  const mtimes: number[] = []

  for (const path of pathsToCheck) {
    try {
      const info = await stat(path)
      mtimes.push(info.mtimeMs)
    } catch {
      continue
    }
  }

  if (mtimes.length === 0) {
    return null
  }

  return new Date(Math.max(...mtimes)).toISOString()
}

async function readCacheFile(cachePath: string): Promise<{ scannedAt: string } | null> {
  try {
    const raw = await readFile(cachePath, { encoding: 'utf-8' })
    const entry = JSON.parse(raw) as { scannedAt: string }
    return entry.scannedAt ? entry : null
  } catch {
    return null
  }
}

export async function getWikiStatus(cwd: string): Promise<WikiStatus> {
  const paths = getWikiPaths(cwd)

  const [hasRoot, hasSchema, hasIndex, hasLog, hasConventions, pages, sources, cacheEntry] =
    await Promise.all([
      pathExists(paths.root),
      pathExists(paths.schemaFile),
      pathExists(paths.indexFile),
      pathExists(paths.logFile),
      pathExists(paths.conventionsFile),
      listMarkdownFiles(paths.pagesDir),
      listMarkdownFiles(paths.sourcesDir),
      readCacheFile(paths.conventionsCacheFile),
    ])

  return {
    initialized: hasRoot && hasSchema && hasIndex && hasLog,
    root: paths.root,
    pageCount: pages.length,
    sourceCount: sources.length,
    hasSchema,
    hasIndex,
    hasLog,
    hasConventions,
    conventionsScannedAt: cacheEntry?.scannedAt ?? null,
    lastUpdatedAt: await getLastUpdatedAt([
      paths.schemaFile,
      paths.indexFile,
      paths.logFile,
      ...pages,
      ...sources,
    ]),
  }
}
