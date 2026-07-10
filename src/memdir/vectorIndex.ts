/**
 * Orama vector search index over memory/ .md files.
 * Provides semantic search across the auto-memory directory.
 */

import { createHash } from 'crypto'
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync, Dirent } from 'fs'
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

interface DirIndex {
  db: any
  pending: Promise<void> | null
}

const indices = new Map<string, DirIndex>()

const INDEX_FILENAME = '.vector-index'
const INDEX_META_FILENAME = '.vector-index-meta.json'

export function getIndexPath(memoryDir: string): string {
  return join(memoryDir, INDEX_FILENAME)
}

export function getIndexMetaPath(memoryDir: string): string {
  return join(memoryDir, INDEX_META_FILENAME)
}

function getMdStats(memoryDir: string): { count: number; totalSize: number; latestMtime: number; contentHash: string } {
  let count = 0
  let totalSize = 0
  let latestMtime = 0
  const hash = createHash('sha256')
  function walk(dir: string, depth: number) {
    if (depth > 4) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isSymbolicLink()) {
        // Do not traverse or index any symlink — a symlinked file or directory
        // could point outside the memory root and leak content into the prompt.
        continue
      }

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') || entry.name === '.facts') {
          walk(fullPath, depth + 1)
        }
      } else if (entry.name.endsWith('.md') && entry.name !== 'MEMORY.md' && !entry.name.startsWith('.')) {
        let st: ReturnType<typeof statSync>
        try {
          st = statSync(fullPath)
        } catch { continue }
        count++
        totalSize += st.size
        hash.update(`${fullPath}:${st.size}:${st.mtimeMs}\0`)
        try {
          hash.update(readFileSync(fullPath, 'utf-8'))
        } catch { /* skip unreadable */ }
        if (st.mtimeMs > latestMtime) latestMtime = st.mtimeMs
      }
    }
  }
  walk(memoryDir, 0)
  return { count, totalSize, latestMtime, contentHash: hash.digest('hex') }
}

async function scanMdFiles(
  memoryDir: string,
): Promise<Array<{ filename: string; path: string; title: string; type: string; description: string; content: string }>> {
  const results: Array<{ filename: string; path: string; title: string; type: string; description: string; content: string }> = []

  function walk(dir: string, depth: number) {
    if (depth > 4) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isSymbolicLink()) {
        // Do not traverse or index any symlink — a symlinked file or directory
        // could point outside the memory root and leak content into the prompt.
        continue
      }

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') || entry.name === '.facts') {
          walk(fullPath, depth + 1)
        }
      } else if (entry.name.endsWith('.md') && entry.name !== 'MEMORY.md' && !entry.name.startsWith('.')) {
        try {
          const raw = readFileSync(fullPath, 'utf-8')
          const parsed = parseFrontmatter(raw)
          const fm = parsed?.frontmatter
          results.push({
            filename: entry.name,
            path: relative(memoryDir, fullPath),
            title: typeof fm?.title === 'string' ? fm.title : entry.name.replace(/\.md$/, ''),
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



function getOrCreateDirState(memoryDir: string): DirIndex {
  let state = indices.get(memoryDir)
  if (!state) {
    state = { db: null, pending: null }
    indices.set(memoryDir, state)
  }
  return state
}

export async function initMemdirIndex(memoryDir: string): Promise<void> {
  const state = getOrCreateDirState(memoryDir)
  if (state.pending) {
    await state.pending
    return
  }

  const indexPath = getIndexPath(memoryDir)
  const metaPath = getIndexMetaPath(memoryDir)

  if (existsSync(indexPath) && existsSync(metaPath)) {
    const indexMtime = statSync(indexPath).mtimeMs
    const stats = getMdStats(memoryDir)
    let storedFileCount = -1
    let storedTotalSize = -1
    let storedContentHash = ''
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      storedFileCount = typeof meta.fileCount === 'number' ? meta.fileCount : -1
      storedTotalSize = typeof meta.totalSize === 'number' ? meta.totalSize : -1
      storedContentHash = typeof meta.contentHash === 'string' ? meta.contentHash : ''
    } catch { /* missing or corrupt meta — rebuild */ }

    if (stats.latestMtime <= indexMtime && stats.count === storedFileCount && stats.totalSize === storedTotalSize && stats.contentHash === storedContentHash) {
      try {
        const data = readFileSync(indexPath)
        state.db = await restore('binary', data)
        return
      } catch {
        // Corrupted index — rebuild
      }
    }
  }

  state.db = await create({ schema: ORAMA_SCHEMA })
  await rebuildIndex(memoryDir)
}

export async function rebuildIndex(memoryDir: string): Promise<void> {
  const state = getOrCreateDirState(memoryDir)
  if (state.pending) await state.pending

  state.pending = (async () => {
    state.db = await create({ schema: ORAMA_SCHEMA })

    const docs = await scanMdFiles(memoryDir)

    for (const doc of docs) {
      await insert(state.db, {
        filename: doc.filename,
        path: doc.path,
        title: doc.title,
        type: doc.type,
        description: doc.description,
        content: doc.content,
      })
    }

    await saveIndex(memoryDir)
  })()

  await state.pending
  state.pending = null
}

export async function searchMemdirIndex(
  query: string,
  memoryDir: string,
  limit = 10,
): Promise<Array<{ path: string; filename: string; title: string; type: string; description: string; content: string; score: number }>> {
  const state = getOrCreateDirState(memoryDir)

  if (!state.db) {
    await initMemdirIndex(memoryDir)
  }

  if (state.db) {
    const indexPath = getIndexPath(memoryDir)
    const metaPath = getIndexMetaPath(memoryDir)
    if (!existsSync(indexPath) || !existsSync(metaPath)) {
      await initMemdirIndex(memoryDir)
    } else {
      const indexMtime = statSync(indexPath).mtimeMs
      const stats = getMdStats(memoryDir)
      let storedFileCount = -1
      let storedTotalSize = -1
      let storedContentHash = ''
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        storedFileCount = typeof meta.fileCount === 'number' ? meta.fileCount : -1
        storedTotalSize = typeof meta.totalSize === 'number' ? meta.totalSize : -1
        storedContentHash = typeof meta.contentHash === 'string' ? meta.contentHash : ''
      } catch { /* ignore */ }
      if (stats.latestMtime > indexMtime || stats.count !== storedFileCount || stats.totalSize !== storedTotalSize || stats.contentHash !== storedContentHash) {
        await initMemdirIndex(memoryDir)
      }
    }
  }

  if (!state.db) return []

  try {
    const results = await search(state.db, { term: query, limit })
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
  const state = indices.get(memoryDir)
  if (!state?.db) return
  const indexPath = getIndexPath(memoryDir)
  const metaPath = getIndexMetaPath(memoryDir)
  try {
    const data = await persist(state.db, 'binary')
    writeFileSync(indexPath, data as Buffer)
    const stats = getMdStats(memoryDir)
    const meta = { fileCount: stats.count, totalSize: stats.totalSize, contentHash: stats.contentHash }
    writeFileSync(metaPath, JSON.stringify(meta), 'utf-8')
  } catch {
    // persist failed — non-fatal
  }
}

export function clearIndex(): void {
  indices.clear()
}
