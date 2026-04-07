import type { Command } from '../../commands.js'

const ragDelete = {
  type: 'local',
  name: 'rag-delete',
  description: '从 pentest RAG 中按 id 或精确标题删除文档',
  aliases: ['rag/delete'],
  supportsNonInteractive: true,
  load: () => import('./rag-delete.js'),
} satisfies Command

export default ragDelete
