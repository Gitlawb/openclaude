import type { LocalCommandCall } from '../../types/command.js'
import { listRagDocumentSummaries } from '../../services/rag/ragDb.js'

export const call: LocalCommandCall = async () => {
  const rows = listRagDocumentSummaries()
  if (rows.length === 0) {
    return { type: 'text', value: 'RAG 库中暂无文档。' }
  }
  const lines = rows.map(
    d =>
      `${d.title}\n  id: ${d.id}\n  created: ${new Date(d.createdAt).toISOString()}`,
  )
  return { type: 'text', value: `共 ${rows.length} 篇文档:\n\n${lines.join('\n\n')}` }
}
