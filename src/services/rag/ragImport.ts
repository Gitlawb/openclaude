import { statSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { basename, extname, resolve, sep } from 'node:path'
import { getCwd } from '../../utils/cwd.js'
import { ragUploadDocument } from './rag.js'
import type { RagDocument } from './types.js'

const MAX_BYTES = 4 * 1024 * 1024
const ALLOWED_EXT = new Set(['.md', '.markdown', '.mdx'])

function isUnderRoot(filePath: string, root: string): boolean {
  const r = resolve(root)
  const f = resolve(filePath)
  if (f === r) return true
  const prefix = r.endsWith(sep) ? r : r + sep
  return f.startsWith(prefix)
}

/**
 * Import a Markdown file from disk into RAG (same store as web upload / ragUploadDocument).
 * Path is resolved from `cwd`; the resolved real path must lie under the real cwd or under
 * OPENCLAUDE_RAG_IMPORT_ROOT (also realpath'd) to limit arbitrary file read.
 */
export async function ragImportMarkdownFromPath(
  userPath: string,
  options?: { title?: string; cwd?: string },
): Promise<RagDocument> {
  const cwd = options?.cwd ?? getCwd()
  const trimmed = userPath.trim()
  if (!trimmed) {
    throw new Error('Path is required')
  }

  const resolvedInput = resolve(cwd, trimmed)
  let realTarget: string
  try {
    realTarget = await realpath(resolvedInput)
  } catch {
    throw new Error(`Path not found: ${trimmed}`)
  }

  const ext = extname(realTarget).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error('Only .md, .markdown, and .mdx files can be imported')
  }

  const st = statSync(realTarget)
  if (!st.isFile()) {
    throw new Error('Not a regular file')
  }
  if (st.size > MAX_BYTES) {
    throw new Error(`File too large (max ${MAX_BYTES} bytes)`)
  }

  let realCwd: string
  try {
    realCwd = await realpath(cwd)
  } catch {
    realCwd = resolve(cwd)
  }

  let allowed = isUnderRoot(realTarget, realCwd)
  if (!allowed && process.env.OPENCLAUDE_RAG_IMPORT_ROOT) {
    const extra = resolve(process.env.OPENCLAUDE_RAG_IMPORT_ROOT)
    try {
      const realExtra = await realpath(extra)
      allowed = isUnderRoot(realTarget, realExtra)
    } catch {
      // ignore invalid extra root
    }
  }
  if (!allowed) {
    throw new Error(
      'Path must be inside the current working directory or OPENCLAUDE_RAG_IMPORT_ROOT (symlinks resolved)',
    )
  }

  const content = await readFile(realTarget, 'utf-8')
  const title =
    options?.title?.trim() ||
    basename(realTarget, extname(realTarget)) ||
    'Untitled'
  return ragUploadDocument(title, content)
}
