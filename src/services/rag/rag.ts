import { randomUUID } from 'node:crypto'
import {
  deleteAllRagChunks,
  getRagDb,
  insertChunksForDocument,
  insertRagDocumentWithChunks,
  listDocumentIdAndContent,
  loadAllRagChunksForRetrieval,
} from './ragDb.js'
import type { RagChunk, RagDocument } from './types.js'

/**
 * Hybrid retrieval: Okapi BM25 over chunk term frequencies + dense similarity
 * (L2-normalized bag-of-hashes vectors, cosine in [0,1] for our non-negative
 * buckets). Candidate pool = union(top-K by BM25, top-K by embedding), then
 * ranked by weighted **min–max normalized** scores so both signals contribute.
 */
const BM25_WEIGHT = 0.6
const EMBED_WEIGHT = 0.4
const RECALL_TOP_PER_CHANNEL = 20
const OUTPUT_TOP_K = 10

function minMaxNorm(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return (value - min) / (max - min)
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function chunkText(text: string, chunkSize = 320, overlap = 80): string[] {
  if (text.length <= chunkSize) return [text]
  const output: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(text.length, start + chunkSize)
    output.push(text.slice(start, end))
    if (end >= text.length) break
    start = Math.max(0, end - overlap)
  }
  return output
}

function tf(tokens: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const token of tokens) out[token] = (out[token] || 0) + 1
  return out
}

function embedding(text: string): number[] {
  const dims = 64
  const vec = new Array(dims).fill(0)
  for (const token of tokenize(text)) {
    let hash = 0
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0
    }
    vec[hash % dims] += 1
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1
  return vec.map(v => v / norm)
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < len; i += 1) dot += a[i]! * b[i]!
  return dot
}

export function ragUploadDocument(title: string, content: string): RagDocument {
  getRagDb()
  const now = Date.now()
  const document: RagDocument = { id: randomUUID(), title, content, createdAt: now }
  const chunks: RagChunk[] = chunkText(content).map((text, chunkIndex) => {
    const tokens = tokenize(text)
    return {
      id: randomUUID(),
      documentId: document.id,
      chunkIndex,
      text,
      tokenCount: tokens.length,
      tf: tf(tokens),
      embedding: embedding(text),
      createdAt: now,
    }
  })

  insertRagDocumentWithChunks(document, chunks)
  return document
}

export function ragRebuildIndex(): void {
  getRagDb()
  const docs = listDocumentIdAndContent()
  deleteAllRagChunks()
  const now = Date.now()
  for (const doc of docs) {
    const rebuilt: RagChunk[] = chunkText(doc.content).map((text, chunkIndex) => {
      const tokens = tokenize(text)
      return {
        id: randomUUID(),
        documentId: doc.id,
        chunkIndex,
        text,
        tokenCount: tokens.length,
        tf: tf(tokens),
        embedding: embedding(text),
        createdAt: now,
      }
    })
    insertChunksForDocument(doc.id, rebuilt)
  }
}

export function ragHybridRetrieve(query: string) {
  const rows = loadAllRagChunksForRetrieval()
  if (rows.length === 0) return []

  const qTokens = tokenize(query)
  const qEmb = embedding(query)
  const chunks = rows
  const N = Math.max(chunks.length, 1)
  const avgDocLen =
    chunks.reduce((sum, c) => sum + c.tokenCount, 0) / N

  const df: Record<string, number> = {}
  for (const chunk of chunks) {
    for (const term of Object.keys(chunk.tf)) {
      df[term] = (df[term] || 0) + 1
    }
  }

  const raw = chunks.map(chunk => {
    const k1 = 1.5
    const b = 0.75
    let bm25 = 0
    for (const term of qTokens) {
      const f = chunk.tf[term] || 0
      if (!f) continue
      const n = df[term] || 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      const denom = f + k1 * (1 - b + b * (chunk.tokenCount / Math.max(avgDocLen, 1)))
      bm25 += idf * ((f * (k1 + 1)) / denom)
    }
    const embSim = cosine(qEmb, chunk.embedding)
    return {
      chunkId: chunk.id,
      title: chunk.documentTitle || 'Unknown',
      text: chunk.text,
      bm25,
      embedding: embSim,
    }
  })

  const bm25Min = Math.min(...raw.map(r => r.bm25))
  const bm25Max = Math.max(...raw.map(r => r.bm25))
  const embMin = Math.min(...raw.map(r => r.embedding))
  const embMax = Math.max(...raw.map(r => r.embedding))

  const scored = raw.map(r => {
    const nB = minMaxNorm(r.bm25, bm25Min, bm25Max)
    const nE = minMaxNorm(r.embedding, embMin, embMax)
    const finalScore = BM25_WEIGHT * nB + EMBED_WEIGHT * nE
    return { ...r, finalScore }
  })

  const topBm25 = [...scored]
    .sort((a, b) => b.bm25 - a.bm25)
    .slice(0, RECALL_TOP_PER_CHANNEL)
  const topEmb = [...scored]
    .sort((a, b) => b.embedding - a.embedding)
    .slice(0, RECALL_TOP_PER_CHANNEL)
  const merged = new Map<string, (typeof scored)[number]>()
  for (const row of [...topBm25, ...topEmb]) merged.set(row.chunkId, row)
  return [...merged.values()]
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, OUTPUT_TOP_K)
}
