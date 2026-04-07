import Database from 'better-sqlite3'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPentestRootDir, invalidatePentestStateCache } from '../pentest/store.js'
import type { RagChunk, RagDocument } from './types.js'

function dbPath(): string {
  return join(getPentestRootDir(), 'rag.sqlite')
}

function stateJsonPath(): string {
  return join(getPentestRootDir(), 'state.json')
}

let dbInstance: Database.Database | null = null

function initSchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS rag_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      tf_json TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_document_id ON rag_chunks(document_id);
  `)
}

/**
 * One-time: legacy state.json rag* → SQLite, then clear rag arrays in JSON.
 */
function migrateJsonRagToSqlite(db: Database.Database): void {
  const row = db.prepare('SELECT COUNT(*) AS c FROM rag_chunks').get() as {
    c: number
  }
  if (row.c > 0) return

  const path = stateJsonPath()
  if (!existsSync(path)) return

  let parsed: {
    ragDocuments?: RagDocument[]
    ragChunks?: RagChunk[]
    [key: string]: unknown
  }
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return
  }

  const docs = parsed.ragDocuments ?? []
  const chunks = parsed.ragChunks ?? []
  if (docs.length === 0 && chunks.length === 0) return

  const insertDoc = db.prepare(
    `INSERT OR REPLACE INTO rag_documents (id, title, content, created_at) VALUES (@id, @title, @content, @createdAt)`,
  )
  const insertChunk = db.prepare(
    `INSERT OR REPLACE INTO rag_chunks (id, document_id, chunk_index, text, token_count, tf_json, embedding_json, created_at)
     VALUES (@id, @documentId, @chunkIndex, @text, @tokenCount, @tfJson, @embeddingJson, @createdAt)`,
  )

  try {
    const run = db.transaction(() => {
      for (const d of docs) {
        insertDoc.run({
          id: d.id,
          title: d.title,
          content: d.content,
          createdAt: d.createdAt,
        })
      }
      for (const c of chunks) {
        insertChunk.run({
          id: c.id,
          documentId: c.documentId,
          chunkIndex: c.chunkIndex,
          text: c.text,
          tokenCount: c.tokenCount,
          tfJson: JSON.stringify(c.tf),
          embeddingJson: JSON.stringify(c.embedding),
          createdAt: c.createdAt,
        })
      }
    })
    run()
  } catch (err) {
    console.error('[openclaude RAG] JSON→SQLite migration failed:', err)
    return
  }

  parsed.ragDocuments = []
  parsed.ragChunks = []
  writeFileSync(path, JSON.stringify(parsed, null, 2), 'utf-8')
  invalidatePentestStateCache()
}

export function getRagDb(): Database.Database {
  if (dbInstance) return dbInstance
  getPentestRootDir()
  dbInstance = new Database(dbPath())
  dbInstance.pragma('journal_mode = WAL')
  initSchema(dbInstance)
  migrateJsonRagToSqlite(dbInstance)
  return dbInstance
}

export type RagChunkRow = RagChunk & { documentTitle: string }

export function insertRagDocumentWithChunks(
  document: RagDocument,
  chunks: RagChunk[],
): void {
  const db = getRagDb()
  const insertDoc = db.prepare(
    `INSERT INTO rag_documents (id, title, content, created_at) VALUES (?, ?, ?, ?)`,
  )
  const insertChunk = db.prepare(
    `INSERT INTO rag_chunks (id, document_id, chunk_index, text, token_count, tf_json, embedding_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const tx = db.transaction(() => {
    insertDoc.run(
      document.id,
      document.title,
      document.content,
      document.createdAt,
    )
    for (const c of chunks) {
      insertChunk.run(
        c.id,
        c.documentId,
        c.chunkIndex,
        c.text,
        c.tokenCount,
        JSON.stringify(c.tf),
        JSON.stringify(c.embedding),
        c.createdAt,
      )
    }
  })
  tx()
}

export function deleteAllRagChunks(): void {
  getRagDb().prepare('DELETE FROM rag_chunks').run()
}

export function loadAllRagChunksForRetrieval(): RagChunkRow[] {
  const db = getRagDb()
  const rows = db
    .prepare(
      `SELECT c.id AS id, c.document_id AS documentId, c.chunk_index AS chunkIndex,
              c.text AS text, c.token_count AS tokenCount, c.tf_json AS tfJson,
              c.embedding_json AS embeddingJson, c.created_at AS createdAt,
              d.title AS documentTitle
       FROM rag_chunks c
       JOIN rag_documents d ON d.id = c.document_id`,
    )
    .all() as Array<{
      id: string
      documentId: string
      chunkIndex: number
      text: string
      tokenCount: number
      tfJson: string
      embeddingJson: string
      createdAt: number
      documentTitle: string
    }>

  return rows.map(r => ({
    id: r.id,
    documentId: r.documentId,
    chunkIndex: r.chunkIndex,
    text: r.text,
    tokenCount: r.tokenCount,
    tf: JSON.parse(r.tfJson) as Record<string, number>,
    embedding: JSON.parse(r.embeddingJson) as number[],
    createdAt: r.createdAt,
    documentTitle: r.documentTitle,
  }))
}

export function listRagDocumentsFromDb(): RagDocument[] {
  const db = getRagDb()
  return db
    .prepare(
      `SELECT id, title, content, created_at AS createdAt FROM rag_documents ORDER BY created_at DESC`,
    )
    .all() as RagDocument[]
}

export type RagDocumentSummary = { id: string; title: string; createdAt: number }

export function listRagDocumentSummaries(): RagDocumentSummary[] {
  const db = getRagDb()
  return db
    .prepare(
      `SELECT id, title, created_at AS createdAt FROM rag_documents ORDER BY created_at DESC`,
    )
    .all() as RagDocumentSummary[]
}

export function getRagStats(): { documents: number; chunks: number } {
  const db = getRagDb()
  const d = db.prepare('SELECT COUNT(*) AS c FROM rag_documents').get() as {
    c: number
  }
  const c = db.prepare('SELECT COUNT(*) AS c FROM rag_chunks').get() as {
    c: number
  }
  return { documents: d.c, chunks: c.c }
}

export function listDocumentIdAndContent(): Array<{ id: string; content: string }> {
  const db = getRagDb()
  return db
    .prepare(`SELECT id, content FROM rag_documents`)
    .all() as Array<{ id: string; content: string }>
}

/**
 * Deletes one document row; SQLite `ON DELETE CASCADE` removes all rag_chunks for that document_id.
 */
export function deleteRagDocumentById(id: string): boolean {
  const db = getRagDb()
  const r = db.prepare('DELETE FROM rag_documents WHERE id = ?').run(id)
  return r.changes > 0
}

export function listRagDocumentIdsByExactTitle(title: string): string[] {
  const db = getRagDb()
  const rows = db
    .prepare('SELECT id FROM rag_documents WHERE title = ?')
    .all(title) as Array<{ id: string }>
  return rows.map(r => r.id)
}

export function insertChunksForDocument(
  documentId: string,
  chunks: RagChunk[],
): void {
  const db = getRagDb()
  const insertChunk = db.prepare(
    `INSERT INTO rag_chunks (id, document_id, chunk_index, text, token_count, tf_json, embedding_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const tx = db.transaction(() => {
    for (const c of chunks) {
      insertChunk.run(
        c.id,
        documentId,
        c.chunkIndex,
        c.text,
        c.tokenCount,
        JSON.stringify(c.tf),
        JSON.stringify(c.embedding),
        c.createdAt,
      )
    }
  })
  tx()
}
