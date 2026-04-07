import type { LocalCommandCall } from '../../types/command.js'
import { ragImportMarkdownFromPath } from '../../services/rag/ragImport.js'

function parseRagAddArgs(raw: string): { path: string; title?: string } {
  let s = raw.trim()
  let title: string | undefined
  const quoted = s.match(/^\s*--title\s+"([^"]*)"\s+/)
  if (quoted) {
    title = quoted[1]
    s = s.slice(quoted[0].length).trim()
  } else {
    const unquoted = s.match(/^\s*--title\s+(\S+)\s+/)
    if (unquoted) {
      title = unquoted[1]
      s = s.slice(unquoted[0].length).trim()
    }
  }
  return { path: s, title }
}

export const call: LocalCommandCall = async args => {
  const { path, title } = parseRagAddArgs(args)
  if (!path) {
    return {
      type: 'text',
      value:
        '用法: /rag-add [--title "标题"] <路径.md>\n' +
        '仅支持 .md / .markdown / .mdx；文件须在当前工作目录内，或位于 OPENCLAUDE_RAG_IMPORT_ROOT 下。',
    }
  }
  try {
    const doc = await ragImportMarkdownFromPath(path, { title })
    return {
      type: 'text',
      value: `已加入 RAG：${doc.title}（id: ${doc.id}）`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { type: 'text', value: `RAG 导入失败: ${msg}` }
  }
}
