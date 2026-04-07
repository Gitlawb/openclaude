import type { Command } from '../../commands.js'

const ragAdd = {
  type: 'local',
  name: 'rag-add',
  description: '将本地 Markdown 文件导入 pentest RAG（与 Web 控制台共用 rag.sqlite）',
  aliases: ['rag/add'],
  supportsNonInteractive: true,
  load: () => import('./rag-add.js'),
} satisfies Command

export default ragAdd
