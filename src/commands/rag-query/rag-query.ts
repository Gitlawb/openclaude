import type { LocalCommandCall } from '../../types/command.js'
import { ragHybridRetrieve } from '../../services/rag/rag.js'

export const call: LocalCommandCall = async args => {
  const q = args.trim()
  if (!q) {
    return {
      type: 'text',
      value: '用法: /rag-query <检索语句>（调试混合检索 Top 结果）',
    }
  }
  const hits = ragHybridRetrieve(q)
  if (hits.length === 0) {
    return { type: 'text', value: '无匹配 chunk（库为空或查询无命中）。' }
  }
  const lines = hits.map(
    (h, i) =>
      `[${i + 1}] score=${h.finalScore.toFixed(4)} bm25=${h.bm25.toFixed(4)} emb=${h.embedding.toFixed(4)}\n` +
      `title: ${h.title}\n` +
      `${h.text.slice(0, 500)}${h.text.length > 500 ? '…' : ''}`,
  )
  return { type: 'text', value: lines.join('\n\n---\n\n') }
}
