export type RagDocument = {
  id: string
  title: string
  content: string
  createdAt: number
}

export type RagChunk = {
  id: string
  documentId: string
  chunkIndex: number
  text: string
  tokenCount: number
  tf: Record<string, number>
  embedding: number[]
  createdAt: number
}
