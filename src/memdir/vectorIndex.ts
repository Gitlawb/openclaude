/**
 * Orama vector search index over memory/ .md files.
 * Provides semantic search across the auto-memory directory.
 */

import { createHash } from 'crypto'
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync, Dirent } from 'fs'
import { join, relative } from 'path'
import { create, insert, search, type Orama as OramaDb } from '@orama/orama'
import { persist, restore } from '@orama/plugin-data-persistence'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { isMemoryWriteApprovalRequired } from '../utils/governancePolicy.js'
import { isAutoMemoryEnabled } from './paths.js'

const ORAMA_SCHEMA = {
  filename: 'string',
  path: 'string',
  title: 'string',
  type: 'string',
  description: 'string',
  content: 'string',
} as const

interface MdStats {
  count: number
  totalSize: number
  latestMtime: number
  fileFingerprint: string
  contentHash: string
}

interface DirIndex {
  db: OramaDb<typeof ORAMA_SCHEMA> | null
  pending: Promise<void> | null
  statsCache?: MdStats
  lastBuiltStats?: MdStats
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

interface FileInfo {
  fullPath: string
  relPath: string
  name: string
  size: number
  mtimeMs: number
}

function getSortedMdFiles(memoryDir: string): FileInfo[] {
  const files: FileInfo[] = []
  function walk(dir: string, depth: number) {
    if (depth > 4) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    // Sort entries by name to guarantee deterministic traversal order (L10)
    entries.sort((a, b) => a.name.localeCompare(b.name))

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)

      if (entry.isSymbolicLink()) continue

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') || entry.name === '.facts') {
          walk(fullPath, depth + 1)
        }
      } else if (entry.name.endsWith('.md') && entry.name !== 'MEMORY.md' && !entry.name.startsWith('.')) {
        try {
          const st = statSync(fullPath)
          // Make sure file is readable before including it (L10)
          const fd = readFileSync(fullPath)
          files.push({
            fullPath,
            relPath: relative(memoryDir, fullPath),
            name: entry.name,
            size: st.size,
            mtimeMs: st.mtimeMs,
          })
        } catch {
          // Skip unreadable files
        }
      }
    }
  }
  walk(memoryDir, 0)
  files.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return files
}

function getMdStats(memoryDir: string): MdStats {
  const files = getSortedMdFiles(memoryDir)
  const count = files.length
  let totalSize = 0
  let latestMtime = 0
  const fingerprint = createHash('sha256')

  for (const f of files) {
    totalSize += f.size
    if (f.mtimeMs > latestMtime) latestMtime = f.mtimeMs
    fingerprint.update(`${f.fullPath}:${f.size}:${f.mtimeMs}\0`)
  }

  const fileFingerprint = fingerprint.digest('hex')

  const state = getOrCreateDirState(memoryDir)
  if (state.statsCache && state.statsCache.fileFingerprint === fileFingerprint) {
    return state.statsCache
  }

  const metaPath = getIndexMetaPath(memoryDir)
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
      if (meta.fileFingerprint === fileFingerprint && typeof meta.contentHash === 'string') {
        const stats = { count, totalSize, latestMtime, fileFingerprint, contentHash: meta.contentHash }
        state.statsCache = stats
        return stats
      }
    } catch { /* ignore */ }
  }

  const contentHasher = createHash('sha256')
  for (const f of files) {
    try {
      const raw = readFileSync(f.fullPath)
      contentHasher.update(raw)
    } catch { /* skip */ }
  }
  const contentHash = contentHasher.digest('hex')
  const stats = { count, totalSize, latestMtime, fileFingerprint, contentHash }
  state.statsCache = stats
  return stats
}

async function scanMdFiles(
  memoryDir: string,
): Promise<Array<{ filename: string; path: string; title: string; type: string; description: string; content: string }>> {
  const files = getSortedMdFiles(memoryDir)
  const results: Array<{ filename: string; path: string; title: string; type: string; description: string; content: string }> = []
  for (const f of files) {
    try {
      const raw = readFileSync(f.fullPath, 'utf-8')
      const parsed = parseFrontmatter(raw)
      const fm = parsed?.frontmatter
      results.push({
        filename: f.name,
        path: f.relPath,
        title: typeof fm?.title === 'string' ? fm.title : f.name.replace(/\.md$/, ''),
        type: typeof fm?.type === 'string' ? fm.type : 'reference',
        description: typeof fm?.description === 'string' ? fm.description : '',
        content: parsed?.content ?? '',
      })
    } catch {
      // skip unreadable files
    }
  }
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

  state.pending = (async () => {
    const indexPath = getIndexPath(memoryDir)
    const metaPath = getIndexMetaPath(memoryDir)
    const stats = getMdStats(memoryDir)

    if (existsSync(indexPath) && existsSync(metaPath)) {
      const indexMtime = statSync(indexPath).mtimeMs
      let storedFileCount = -1
      let storedTotalSize = -1
      let storedFileFingerprint = ''
      let storedContentHash = ''
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
        storedFileCount = typeof meta.fileCount === 'number' ? meta.fileCount : -1
        storedTotalSize = typeof meta.totalSize === 'number' ? meta.totalSize : -1
        storedFileFingerprint = typeof meta.fileFingerprint === 'string' ? meta.fileFingerprint : (typeof meta.contentHash === 'string' ? meta.contentHash : '')
        storedContentHash = typeof meta.contentHash === 'string' ? meta.contentHash : ''
      } catch { /* missing or corrupt meta — rebuild */ }

      if (stats.latestMtime <= indexMtime && stats.count === storedFileCount && stats.totalSize === storedTotalSize && stats.fileFingerprint === storedFileFingerprint && stats.contentHash === storedContentHash) {
        try {
          const data = readFileSync(indexPath)
          const restored = await restore('binary', data) as OramaDb<typeof ORAMA_SCHEMA>
          const schema = restored.schema
          const expectedFields = Object.keys(ORAMA_SCHEMA) as Array<keyof typeof ORAMA_SCHEMA>
          let isCompatible = !!schema
          if (schema) {
            for (const key of expectedFields) {
              if (schema[key] !== ORAMA_SCHEMA[key]) {
                isCompatible = false
                break
              }
            }
          }
          if (isCompatible) {
            state.db = restored
            state.lastBuiltStats = stats
            return
          }
        } catch {
          // Corrupted index — rebuild
        }
      }
    }

    await performRebuildIndex(memoryDir, state)
  })()

  try {
    await state.pending
  } finally {
    state.pending = null
  }
}

async function performRebuildIndex(memoryDir: string, state: DirIndex): Promise<void> {
  const stats = getMdStats(memoryDir)
  const newDb = await create({ schema: ORAMA_SCHEMA }) as OramaDb<typeof ORAMA_SCHEMA>
  const docs = await scanMdFiles(memoryDir)

  for (const doc of docs) {
    await insert(newDb, {
      filename: doc.filename,
      path: doc.path,
      title: doc.title,
      type: doc.type,
      description: doc.description,
      content: doc.content,
    })
  }

  state.db = newDb
  state.lastBuiltStats = stats
  await saveIndex(memoryDir)
}

export async function rebuildIndex(memoryDir: string): Promise<void> {
  const state = getOrCreateDirState(memoryDir)
  if (state.pending) {
    await state.pending
    return
  }

  state.pending = performRebuildIndex(memoryDir, state)

  try {
    await state.pending
  } finally {
    state.pending = null
  }
}

export async function searchMemdirIndex(
  query: string,
  memoryDir: string,
  limit = 10,
): Promise<Array<{ path: string; filename: string; title: string; type: string; description: string; content: string; score: number }>> {
  const state = getOrCreateDirState(memoryDir)

  if (state.pending) {
    await state.pending
  }

  if (!state.db) {
    await initMemdirIndex(memoryDir)
  }

  if (state.db) {
    const stats = getMdStats(memoryDir)
    if (state.lastBuiltStats) {
      if (
        stats.count !== state.lastBuiltStats.count ||
        stats.totalSize !== state.lastBuiltStats.totalSize ||
        stats.fileFingerprint !== state.lastBuiltStats.fileFingerprint ||
        stats.contentHash !== state.lastBuiltStats.contentHash
      ) {
        await initMemdirIndex(memoryDir)
      }
    } else {
      const indexPath = getIndexPath(memoryDir)
      const metaPath = getIndexMetaPath(memoryDir)
      if (!existsSync(indexPath) || !existsSync(metaPath)) {
        await initMemdirIndex(memoryDir)
      } else {
        const indexMtime = statSync(indexPath).mtimeMs
        let storedFileCount = -1
        let storedTotalSize = -1
        let storedFileFingerprint = ''
        let storedContentHash = ''
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
          storedFileCount = typeof meta.fileCount === 'number' ? meta.fileCount : -1
          storedTotalSize = typeof meta.totalSize === 'number' ? meta.totalSize : -1
          storedFileFingerprint = typeof meta.fileFingerprint === 'string' ? meta.fileFingerprint : (typeof meta.contentHash === 'string' ? meta.contentHash : '')
          storedContentHash = typeof meta.contentHash === 'string' ? meta.contentHash : ''
        } catch { /* ignore */ }
        if (stats.latestMtime > indexMtime || stats.count !== storedFileCount || stats.totalSize !== storedTotalSize || stats.fileFingerprint !== storedFileFingerprint || stats.contentHash !== storedContentHash) {
          await initMemdirIndex(memoryDir)
        }
      }
    }
  }

  if (!state.db) return []

  try {
    const results = await search(state.db, { term: query, limit })
    return results.hits.map(hit => {
      const doc = hit.document
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
  if (!isAutoMemoryEnabled() || isMemoryWriteApprovalRequired()) return
  const indexPath = getIndexPath(memoryDir)
  const metaPath = getIndexMetaPath(memoryDir)
  try {
    const data = await persist(state.db, 'binary')
    writeFileSync(indexPath, data as Buffer)
    const stats = getMdStats(memoryDir)
    const meta = { fileCount: stats.count, totalSize: stats.totalSize, fileFingerprint: stats.fileFingerprint, contentHash: stats.contentHash }
    writeFileSync(metaPath, JSON.stringify(meta), 'utf-8')
  } catch {
    // persist failed — non-fatal
  }
}

export function clearIndex(memoryDir: string): void {
  indices.delete(memoryDir)
}

export function clearAllIndices(): void {
  indices.clear()
}
