import type { LocalCommandCall } from '../../types/command.js'
import {
  deleteRagDocumentById,
  listRagDocumentIdsByExactTitle,
} from '../../services/rag/ragDb.js'

function parseDeleteArgs(raw: string): { mode: 'id'; id: string } | { mode: 'title'; title: string } {
  const t = raw.trim()
  if (t.startsWith('--title ')) {
    let rest = t.slice('--title '.length).trim()
    if (rest.startsWith('"')) {
      const end = rest.indexOf('"', 1)
      if (end === -1) {
        throw new Error('标题引号未闭合')
      }
      return { mode: 'title', title: rest.slice(1, end) }
    }
    return { mode: 'title', title: rest }
  }
  return { mode: 'id', id: t }
}

export const call: LocalCommandCall = async args => {
  const trimmed = args.trim()
  if (!trimmed) {
    return {
      type: 'text',
      value:
        '用法: /rag-delete <文档 id>\n' + '  或: /rag-delete --title "与库中完全一致的标题"',
    }
  }
  try {
    const parsed = parseDeleteArgs(trimmed)
    if (parsed.mode === 'id') {
      const ok = deleteRagDocumentById(parsed.id)
      return {
        type: 'text',
        value: ok ? `已删除文档 id: ${parsed.id}` : `未找到 id: ${parsed.id}`,
      }
    }
    const ids = listRagDocumentIdsByExactTitle(parsed.title)
    if (ids.length === 0) {
      return { type: 'text', value: `未找到标题: ${parsed.title}` }
    }
    if (ids.length > 1) {
      return {
        type: 'text',
        value: `标题重复（${ids.length} 条），请用 id 删除：\n${ids.join('\n')}`,
      }
    }
    deleteRagDocumentById(ids[0]!)
    return { type: 'text', value: `已删除「${parsed.title}」（id: ${ids[0]}）` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { type: 'text', value: `RAG 删除失败: ${msg}` }
  }
}
