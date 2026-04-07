import type { LocalCommandCall } from '../../types/command.js'
import { ragRebuildIndex } from '../../services/rag/rag.js'
import { getRagStats } from '../../services/rag/ragDb.js'

export const call: LocalCommandCall = async () => {
  ragRebuildIndex()
  const { documents, chunks } = getRagStats()
  return {
    type: 'text',
    value: `已按当前正文重新切块并写入索引。统计: ${documents} 篇文档, ${chunks} 个 chunk。`,
  }
}
