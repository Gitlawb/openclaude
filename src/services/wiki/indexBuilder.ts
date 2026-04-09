import { readdir, readFile, writeFile } from 'fs/promises'
import { basename, relative } from 'path'
import { getWikiPaths } from './paths.js'

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath)
    }
  }

  return files.sort()
}

async function getPageTitle(path: string): Promise<string> {
  const content = await readFile(path, 'utf8')
  const titleLine = content
    .split('\n')
    .map(line => line.trim())
    .find(line => line.startsWith('# '))

  return titleLine ? titleLine.replace(/^#\s+/, '') : basename(path, '.md')
}

export async function rebuildWikiIndex(cwd: string): Promise<void> {
  const paths = getWikiPaths(cwd)
  const pageFiles = await listMarkdownFiles(paths.pagesDir)
  const sourceFiles = await listMarkdownFiles(paths.sourcesDir)

  const pageLinks = await Promise.all(
    pageFiles.map(async file => {
      const rel = relative(paths.root, file)
      const title = await getPageTitle(file)
      return `- [${title}](./${rel.replace(/\\/g, '/')})`
    }),
  )

  const sourceLinks = sourceFiles.map(file => {
    const rel = relative(paths.root, file).replace(/\\/g, '/')
    const title = basename(file, '.md')
    return `- [${title}](./${rel})`
  })

  const content = `# ${basename(cwd)} Wiki

This wiki is maintained by Atreides Forge as a durable project knowledge layer.

## Core Pages

${pageLinks.length > 0 ? pageLinks.join('\n') : '- No pages yet'}

## Sources

${sourceLinks.length > 0 ? sourceLinks.join('\n') : '- No sources yet'}

## Recent Updates

- See [log.md](./log.md)
`

  await writeFile(paths.indexFile, content, 'utf8')
}
