import { readFileSync } from 'node:fs'
import { relative, basename } from 'node:path'
import { SEMANTIC_JSON_SCHEMA, LAYER_VALUES } from './schema.js'

export type PromptInput = {
  slug: string
  sourcePath: string
  files: string[]
  repoRoot: string
  exports: string[]
  imports: { specifier: string; resolvedPath: string | null; isTypeOnly: boolean }[]
  readmeSnippet?: string
}

export type BuiltPrompt = {
  systemPrompt: string
  userPrompt: string
  schema: typeof SEMANTIC_JSON_SCHEMA
}

const MAX_FILE_SNIPPET_LINES = 40
const MAX_FILES_IN_LISTING = 30
const MAX_SNIPPET_FILES = 3

/**
 * Build the system + user prompts for one module's semantic LLM pass.
 */
export function buildSemanticPrompt(input: PromptInput): BuiltPrompt {
  const { slug, sourcePath, files, repoRoot, exports: exps, imports, readmeSnippet } = input

  const relFiles = files.map(f => relative(repoRoot, f))
  const fileListing = relFiles.length <= MAX_FILES_IN_LISTING
    ? relFiles.join('\n')
    : [...relFiles.slice(0, MAX_FILES_IN_LISTING), `…+${relFiles.length - MAX_FILES_IN_LISTING} more`].join('\n')

  // Pick top 3 files by size for snippets
  const filesBySize = files
    .map(f => {
      try { return { path: f, size: readFileSync(f, 'utf-8').length } } catch { return null }
    })
    .filter((x): x is { path: string; size: number } => x !== null)
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_SNIPPET_FILES)

  const snippets = filesBySize.map(({ path: fp }) => {
    try {
      const content = readFileSync(fp, 'utf-8')
      const lines = content.split('\n').slice(0, MAX_FILE_SNIPPET_LINES)
      const truncated = content.split('\n').length > MAX_FILE_SNIPPET_LINES
        ? `\n… (truncated at ${MAX_FILE_SNIPPET_LINES} lines)`
        : ''
      return `### ${relative(repoRoot, fp)}\n\`\`\`\n${lines.join('\n')}${truncated}\n\`\`\``
    } catch {
      return null
    }
  }).filter(Boolean).join('\n\n')

  const exportsList = exps.length > 0
    ? `Exports: ${exps.join(', ')}`
    : 'Exports: (none detected)'

  const internalImports = imports
    .filter(i => i.resolvedPath != null && !i.isTypeOnly)
    .map(i => i.specifier)
  const externalImports = imports
    .filter(i => i.resolvedPath == null)
    .map(i => i.specifier)

  const importSection = [
    internalImports.length > 0 ? `Internal imports: ${[...new Set(internalImports)].join(', ')}` : '',
    externalImports.length > 0 ? `External imports: ${[...new Set(externalImports)].join(', ')}` : '',
  ].filter(Boolean).join('\n')

  const readmeSection = readmeSnippet
    ? `\nREADME excerpt:\n${readmeSnippet}`
    : ''

  const systemPrompt = `You are a code analyst. Given a source module, produce a JSON object with:
- "summary": one-sentence description of the module's purpose (max 160 chars)
- "responsibilities": 3-7 bullet points describing what this module does
- "domain": a kebab-case domain label (e.g., "vault", "auth", "cli", "testing")
- "layer": one of ${LAYER_VALUES.map(v => `"${v}"`).join(', ')}

Respond ONLY with valid JSON matching the schema. No markdown, no explanation.`

  const userPrompt = `Module: ${slug}
Path: ${relative(repoRoot, sourcePath)}/

Files (${files.length}):
${fileListing}

${exportsList}
${importSection}${readmeSection}

Top files by size:

${snippets}`

  return {
    systemPrompt,
    userPrompt,
    schema: SEMANTIC_JSON_SCHEMA,
  }
}
