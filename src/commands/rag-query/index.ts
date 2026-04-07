import type { Command } from '../../commands.js'

const ragQuery = {
  type: 'local',
  name: 'rag-query',
  description: '对 RAG 库做一次混合检索并打印 Top 命中（调试用）',
  aliases: ['rag/query'],
  supportsNonInteractive: true,
  load: () => import('./rag-query.js'),
} satisfies Command

export default ragQuery
