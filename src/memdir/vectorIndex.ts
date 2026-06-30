/**
 * Orama vector search index over memory/ .md files.
 * Provides semantic search across the auto-memory directory.
 */

import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { create, insert, search } from '@orama/orama'
import { persist, restore } from '@orama/plugin-data-persistence'
import { parseFrontmatter } from '../utils/frontmatterParser.js'

const ORAMA_SCHEMA = {
  filename: 'string',
  path: 'string',
  title: 'string',
  type: 'string',
  description: 'string',
  content: 'string',
} as const

let indexDb: any = null
let indexDir: string | null = null

const INDEX_FILENAME = '.vector-index'
const INDEX_META_FILENAME = '.vector-index-meta.json'

export function getIndexPath(memoryDir: string): string {
  return join(memoryDir, INDEX_FILENAME)
}

export function getIndexMetaPath(memoryDir: string): string {
  return join(memoryDir, INDEX_META_FILENAME)
}

function countMdFiles(memoryDir: string): number {
  let count = 0
  function walk(dir: string, depth: number) {
    if (depth > 4) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(fullPath, depth + 1)
      } else if (entry.endsWith('.md') && entry !== 'MEMORY.md' && !entry.startsWith('.')) {
        count++
      }
    }
  }
  walk(memoryDir, 0)
  return count
}

async function scanMdFiles(
  memoryDir: string,
): Promise<Array<{ filename: string; path: string; title: string; type: string; description: string; content: string }>> {
  const results: Array<{ filename: string; path: string; title: string; type: string; description: string; content: string }> = []

  function walk(dir: string, depth: number) {
    if (depth > 4) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(fullPath, depth + 1)
      } else if (entry.endsWith('.md') && entry !== 'MEMORY.md' && !entry.startsWith('.')) {
        try {
          const raw = readFileSync(fullPath, 'utf-8')
          const parsed = parseFrontmatter(raw)
          const fm = parsed?.frontmatter
          results.push({
            filename: entry,
            path: relative(memoryDir, fullPath),
            title: typeof fm?.title === 'string' ? fm.title : entry.replace(/\.md$/, ''),
            type: typeof fm?.type === 'string' ? fm.type : 'reference',
            description: typeof fm?.description === 'string' ? fm.description : '',
            content: parsed?.content ?? '',
          })
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  walk(memoryDir, 0)
  return results
}

function getLatestMdMtime(memoryDir: string): number {
  let latest = 0
  function walk(dir: string, depth: number) {
    if (depth > 4) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(fullPath, depth + 1)
      } else if (entry.endsWith('.md') && entry !== 'MEMORY.md' && !entry.startsWith('.')) {
        if (stat.mtimeMs > latest) latest = stat.mtimeMs
      }
    }
  }
  walk(memoryDir, 0)
  return latest
}

export async function initMemdirIndex(memoryDir: string): Promise<void> {
  const indexPath = getIndexPath(memoryDir)
  const metaPath = getIndexMetaPath(memoryDir)

  if (existsSync(indexPath) && existsSync(metaPath)) {
    const indexMtime = statSync(indexPath).mtimeMs
    const latestMtime = getLatestMdMtime(memoryDir)
    const currentFileCount = countMdFiles(memoryDir)
    let storedFileCount = -1
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      storedFileCount = typeof meta.fileCount === 'number' ? meta.fileCount : -1
    } catch { /* missing or corrupt meta — rebuild */ }

    if (latestMtime <= indexMtime && currentFileCount === storedFileCount) {
      try {
        const data = readFileSync(indexPath)
        indexDb = await restore('binary', data)
        indexDir = memoryDir
        return
      } catch {
        // Corrupted index — rebuild
      }
    }
  }

  indexDb = await create({ schema: ORAMA_SCHEMA })
  indexDir = memoryDir
  await rebuildIndex(memoryDir)
}

export async function rebuildIndex(memoryDir: string): Promise<void> {
  indexDb = await create({ schema: ORAMA_SCHEMA })
  indexDir = memoryDir

  const docs = await scanMdFiles(memoryDir)

  for (const doc of docs) {
    await insert(indexDb, {
      filename: doc.filename,
      path: doc.path,
      title: doc.title,
      type: doc.type,
      description: doc.description,
      content: doc.content,
    })
  }

  await saveIndex(memoryDir)
}

export async function searchMemdirIndex(
  query: string,
  memoryDir: string,
  limit = 10,
): Promise<Array<{ path: string; filename: string; title: string; type: string; description: string; content: string; score: number }>> {
  // Refresh the index if it hasn't been loaded yet or if the directory changed.
  if (!indexDb || indexDir !== memoryDir) {
    await initMemdirIndex(memoryDir)
  }

  // Even when the index is already loaded, check freshness so that files
  // written by /remember, extract-memories, auto-dream, or direct edits
  // are visible to the next search without an explicit rebuildIndex() call.
  // Missing index or meta file is treated as stale — otherwise a failed
  // saveIndex() would leave the stale in-memory DB active indefinitely.
  if (indexDb && indexDir === memoryDir) {
    const indexPath = getIndexPath(memoryDir)
    const metaPath = getIndexMetaPath(memoryDir)
    if (!existsSync(indexPath) || !existsSync(metaPath)) {
      await initMemdirIndex(memoryDir)
    } else {
      const indexMtime = statSync(indexPath).mtimeMs
      const latestMtime = getLatestMdMtime(memoryDir)
      const currentFileCount = countMdFiles(memoryDir)
      let storedFileCount = -1
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        storedFileCount = typeof meta.fileCount === 'number' ? meta.fileCount : -1
      } catch { /* ignore */ }
      if (latestMtime > indexMtime || currentFileCount !== storedFileCount) {
        await initMemdirIndex(memoryDir)
      }
    }
  }

  if (!indexDb) return []

  try {
    const results = await search(indexDb, { term: query, limit })
    return results.hits.map(hit => {
      const doc = hit.document as any
      return {
        path: doc.path,
        filename: doc.filename,
        title: doc.title,
        type: doc.type,
        description: doc.description,
        content: doc.content ?? '',
        score: hit.score || 0,
      }
    })
  } catch {
    return []
  }
}

export async function saveIndex(memoryDir: string): Promise<void> {
  if (!indexDb) return
  const indexPath = getIndexPath(memoryDir)
  const metaPath = getIndexMetaPath(memoryDir)
  try {
    const data = await persist(indexDb, 'binary')
    writeFileSync(indexPath, data as Buffer)
    const meta = { fileCount: countMdFiles(memoryDir) }
    writeFileSync(metaPath, JSON.stringify(meta), 'utf-8')
  } catch {
    // persist failed — non-fatal
  }
}

export function clearIndex(): void {
  indexDb = null
  indexDir = null
}
