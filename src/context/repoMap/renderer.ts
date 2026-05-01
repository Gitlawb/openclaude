import type { FileTags, Tag } from './types.js'
import type { RankedFile } from './pagerank.js'
import { countTokens } from './tokenize.js'

/**
 * Render a token-budgeted repo map from ranked files and their tags.
 *
 * Format per file:
 *   path/to/file.ts:
 *   ⋮
 *     signature line for def 1
 *   ⋮
 *     signature line for def 2
 *   ⋮
 *
 * Files that don't fit within the budget are dropped entirely.
 */
export function renderMap(
  rankedFiles: RankedFile[],
  fileTagsMap: Map<string, FileTags>,
  maxTokens: number,
): { map: string; tokenCount: number; fileCount: number } {
  const sections: string[] = []
  let currentTokens = 0
  let fileCount = 0

  for (const { path } of rankedFiles) {
    const ft = fileTagsMap.get(path)
    if (!ft) continue

    // Only include definitions in the rendered output
    const defs = ft.tags
      .filter(t => t.kind === 'def')
      .sort((a, b) => a.line - b.line)

    if (defs.length === 0) continue

    const section = renderFileSection(path, defs)
    const sectionTokens = countTokens(section)

    // Would this section bust the budget?
    if (currentTokens + sectionTokens > maxTokens) {
      // Don't include partial files — drop entirely
      break
    }

    sections.push(section)
    currentTokens += sectionTokens
    fileCount++
  }

  const map = sections.join('\n')
  return { map, tokenCount: currentTokens, fileCount }
}

function renderFileSection(path: string, defs: Tag[]): string {
  const lines: string[] = [`${path}:`]
  let lastLine = 0

  for (const def of defs) {
    // Add elision marker if there's a gap
    if (def.line > lastLine + 1) {
      lines.push('⋮')
    }
    lines.push(`  ${def.signature}`)
    lastLine = def.line
  }

  // Trailing elision marker
  lines.push('⋮')
  return lines.join('\n')
}
