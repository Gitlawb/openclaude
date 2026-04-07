import type { Command } from '../../commands.js'

const ragRebuild = {
  type: 'local',
  name: 'rag-rebuild',
  description: '重建 RAG 切块与检索索引（保留文档正文，重写 rag_chunks）',
  aliases: ['rag/rebuild'],
  supportsNonInteractive: true,
  load: () => import('./rag-rebuild.js'),
} satisfies Command

export default ragRebuild
