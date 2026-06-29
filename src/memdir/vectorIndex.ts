/**
 * Orama vector search index over memory/ .md files.
 * Provides semantic search across the auto-memory directory.
 */

import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { create, insert, search, type Orama, remove } from '@orama/orama'
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

let indexDb: Orama<typeof ORAMA_SCHEMA> | null = null
let indexDir: string | null = null

const INDEX_FILENAME = '.vector-index'

export function getIndexPath(memoryDir: string): string {
  return join(memoryDir, INDEX_FILENAME)
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
          const content = readFileSync(fullPath, 'utf-8')
          const fm = parseFrontmatter(content)
          const body = content.replace(/^---[\s\S]*?---\n*/, '').trim()
          results.push({
            filename: entry,
            path: relative(memoryDir, fullPath),
            title: (fm?.title as string) || entry.replace(/\.md$/, ''),
            type: (fm?.type as string) || 'reference',
            description: (fm?.description as string) || '',
            content: body,
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

export async function initMemdirIndex(memoryDir: string): Promise<void> {
  const indexPath = getIndexPath(memoryDir)

  if (existsSync(indexPath)) {
    try {
      const data = readFileSync(indexPath)
      indexDb = await restore<typeof ORAMA_SCHEMA>('binary', data)
      indexDir = memoryDir
      return
    } catch {
      // Corrupted index — rebuild
    }
  }

  indexDb = await create({ schema: ORAMA_SCHEMA })
  indexDir = memoryDir
  await rebuildIndex(memoryDir)
}

export async function rebuildIndex(memoryDir: string): Promise<void> {
  if (!indexDb) {
    indexDb = await create({ schema: ORAMA_SCHEMA })
    indexDir = memoryDir
  }

  const docs = await scanMdFiles(memoryDir)

  for (const doc of docs) {
    try {
      await remove(indexDb, doc.path)
    } catch {
      // not found — ok
    }
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
): Promise<Array<{ path: string; filename: string; title: string; type: string; description: string; score: number }>> {
  if (!indexDb || indexDir !== memoryDir) {
    await initMemdirIndex(memoryDir)
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
  try {
    const data = await persist(indexDb, 'binary')
    writeFileSync(indexPath, data as Buffer)
  } catch {
    // persist failed — non-fatal
  }
}

export function clearIndex(): void {
  indexDb = null
  indexDir = null
}
