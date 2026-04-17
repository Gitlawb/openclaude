import { join } from 'path'
import type { WikiPaths } from './types.js'

export const OPENCLAUDE_DIRNAME = '.nnc'
export const WIKI_DIRNAME = 'wiki'

export function getWikiPaths(cwd: string): WikiPaths {
  const root = join(cwd, OPENCLAUDE_DIRNAME, WIKI_DIRNAME)

  return {
    root,
    pagesDir: join(root, 'pages'),
    sourcesDir: join(root, 'sources'),
    schemaFile: join(root, 'schema.md'),
    indexFile: join(root, 'index.md'),
    logFile: join(root, 'log.md'),
  }
}
