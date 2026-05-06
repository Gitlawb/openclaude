import { readFileSync } from 'fs'
import { join } from 'path'
import { getLanguageForFile } from './gitFiles.js'
import { createParser, loadLanguage, loadQuery } from './parser.js'
import type { FileTags, Tag } from './types.js'

/**
 * Extract definition and reference tags from a single source file.
 * Returns null if the file can't be parsed (unsupported language, parse error, etc).
 */
export async function extractTags(
  filePath: string,
  root: string,
): Promise<FileTags | null> {
  const language = getLanguageForFile(filePath)
  if (!language) return null

  const absolutePath = join(root, filePath)
  let source: string
  try {
    source = readFileSync(absolutePath, 'utf-8')
  } catch {
    return null
  }

  const lines = source.split('\n')

  const parser = await createParser(language)
  if (!parser) return null

  const querySource = loadQuery(language)
  if (!querySource) {
    parser.delete()
    return null
  }

  try {
    const tree = parser.parse(source) as {
      rootNode: unknown
    }

    const lang = await loadLanguage(language)
    if (!lang) {
      parser.delete()
      return null
    }

    // Use the non-deprecated Query constructor
    const { Query } = await import('web-tree-sitter')
    const query = new Query(lang, querySource) as {
      matches(rootNode: unknown): Array<{
        pattern: number
        captures: Array<{
          name: string
          node: {
            text: string
            startPosition: { row: number; column: number }
            endPosition: { row: number; column: number }
          }
        }>
      }>
    }

    const matches = query.matches(tree.rootNode)
    const tags: Tag[] = []
    const seen = new Set<string>() // dedup by kind+name+line

    for (const match of matches) {
      let name: string | null = null
      let kind: 'def' | 'ref' | null = null
      let subKind: string | undefined
      let lineRow = 0

      for (const capture of match.captures) {
        const captureName = capture.name

        // Name captures: name.definition.X or name.reference.X
        if (captureName.startsWith('name.definition.')) {
          name = capture.node.text
          kind = 'def'
          subKind = captureName.slice('name.definition.'.length)
          lineRow = capture.node.startPosition.row
        } else if (captureName.startsWith('name.reference.')) {
          name = capture.node.text
          kind = 'ref'
          subKind = captureName.slice('name.reference.'.length)
          lineRow = capture.node.startPosition.row
        }
      }

      if (name && kind) {
        const key = `${kind}:${name}:${lineRow}`
        if (!seen.has(key)) {
          seen.add(key)
          const line = lineRow + 1 // convert 0-based to 1-based
          const signature = lines[lineRow]?.trimEnd() ?? ''
          tags.push({ kind, name, line, signature, subKind })
        }
      }
    }

    parser.delete()
    return { path: filePath, tags }
  } catch {
    parser.delete()
    return null
  }
}
