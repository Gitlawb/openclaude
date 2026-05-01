import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getBundledQuery } from './queries.js'
import type { SupportedLanguage } from './types.js'

// Resolve project root in both source and bundled modes.
// In source (bun test/dev): import.meta.url is src/context/repoMap/parser.ts → go up 4 levels
// In bundle (node dist/cli.mjs): import.meta.url is dist/cli.mjs → go up 2 levels
const __filename = fileURLToPath(import.meta.url)
const __projectRoot = join(
  __filename,
  process.env.NODE_ENV === 'test' ? '../../../../' : '../../',
)

// web-tree-sitter types
type TreeSitterParser = {
  parse(input: string): { rootNode: unknown }
  setLanguage(lang: unknown): void
  delete(): void
}

type TreeSitterLanguage = {
  query(source: string): unknown
}

// The actual module exports { Parser, Language } as named exports
let ParserClass: (new () => TreeSitterParser) & {
  init(opts?: { locateFile?: (file: string) => string }): Promise<void>
} | null = null
let LanguageLoader: {
  load(path: string | Uint8Array): Promise<TreeSitterLanguage>
} | null = null

let initialized = false
const languageCache = new Map<SupportedLanguage, TreeSitterLanguage>()
const queryCache = new Map<SupportedLanguage, string>()

/** Resolve the path to the tree-sitter WASM file. */
function getTreeSitterWasmPath(): string {
  // Try require.resolve first (works in source mode with node_modules)
  try {
    const webTsDir = resolve(
      require.resolve('web-tree-sitter/package.json'),
      '..',
    )
    return join(webTsDir, 'tree-sitter.wasm')
  } catch {
    // Fallback: relative to project root
    return join(__projectRoot, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm')
  }
}

/** Resolve the path to a language WASM grammar file. */
function getLanguageWasmPath(language: SupportedLanguage): string {
  const wasmName = language === 'typescript' ? 'tree-sitter-typescript' :
    language === 'javascript' ? 'tree-sitter-javascript' :
      `tree-sitter-${language}`

  try {
    const wasmDir = resolve(
      require.resolve('tree-sitter-wasms/package.json'),
      '..',
      'out',
    )
    return join(wasmDir, `${wasmName}.wasm`)
  } catch {
    return join(__projectRoot, 'node_modules', 'tree-sitter-wasms', 'out', `${wasmName}.wasm`)
  }
}

/** Initialize the tree-sitter WASM module. */
export async function initParser(): Promise<void> {
  if (initialized) return

  try {
    const mod = await import('web-tree-sitter')
    ParserClass = mod.Parser as typeof ParserClass
    LanguageLoader = mod.Language as typeof LanguageLoader

    const wasmPath = getTreeSitterWasmPath()
    await ParserClass!.init({
      locateFile: () => wasmPath,
    })
    initialized = true
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[repoMap] Failed to initialize tree-sitter:', err)
    throw err
  }
}

/** Load a language grammar. Cached after first load. */
export async function loadLanguage(language: SupportedLanguage): Promise<TreeSitterLanguage | null> {
  if (languageCache.has(language)) {
    return languageCache.get(language)!
  }

  if (!initialized) {
    await initParser()
  }

  try {
    const wasmPath = getLanguageWasmPath(language)
    const lang = await LanguageLoader!.load(wasmPath)
    languageCache.set(language, lang)
    return lang
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[repoMap] Failed to load ${language} grammar:`, err)
    return null
  }
}

/** Load the tag query for a language. Cached after first load.
 *
 * Reads from bundled string constants so the queries ship inside dist/cli.mjs
 * — the .scm files in ./queries/ are kept as canonical source only, and are
 * not part of the published npm package.
 */
export function loadQuery(language: SupportedLanguage): string | null {
  if (queryCache.has(language)) {
    return queryCache.get(language)!
  }

  const content = getBundledQuery(language)
  if (content === null) return null

  queryCache.set(language, content)
  return content
}

/** Create a new parser instance with the given language set. */
export async function createParser(language: SupportedLanguage): Promise<TreeSitterParser | null> {
  if (!initialized) {
    await initParser()
  }

  const lang = await loadLanguage(language)
  if (!lang) return null

  try {
    const parser = new ParserClass!()
    parser.setLanguage(lang)
    return parser
  } catch {
    return null
  }
}

/** Clear all caches (useful for testing). */
export function clearParserCaches(): void {
  languageCache.clear()
  queryCache.clear()
  initialized = false
  ParserClass = null
  LanguageLoader = null
}
