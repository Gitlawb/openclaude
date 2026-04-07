import type { Command } from '../../commands.js'

const ragList = {
  type: 'local',
  name: 'rag-list',
  description: '列出 pentest RAG 中的文档（id / 标题 / 时间）',
  aliases: ['rag/list'],
  supportsNonInteractive: true,
  load: () => import('./rag-list.js'),
} satisfies Command

export default ragList
