import { join, win32 } from 'path'
import { pathToFileURL } from 'url'

export function getDistImportSpecifier(baseDir) {
  if (/^[A-Za-z]:\\/.test(baseDir)) {
    const distPath = win32.join(baseDir, '..', 'dist', 'cli.mjs')
    return `file:///${distPath.replace(/\\/g, '/')}`
  }

  const joinImpl = join
  const distPath = joinImpl(baseDir, '..', 'dist', 'cli.mjs')
  return pathToFileURL(distPath).href
}
