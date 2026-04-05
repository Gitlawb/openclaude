import { isAbsolute } from 'path'
import { getFsImplementation } from './fsOperations.js'
import { isImageFilePath } from './imagePaste.js'

/**
 * Detect absolute file paths in pasted text (typically from drag-and-drop).
 * Returns the cleaned paths if ALL segments are existing non-image files,
 * or an empty array otherwise.
 *
 * Splitting logic mirrors usePasteHandler: space preceding `/` or a Windows
 * drive letter, plus newline separators.
 */
export function extractDraggedFilePaths(text: string): string[] {
  const segments = text
    .split(/ (?=\/|[A-Za-z]:\\)/)
    .flatMap(part => part.split('\n'))
    .map(s => s.trim())
    .filter(Boolean)

  if (segments.length === 0) return []

  const fs = getFsImplementation()
  const cleaned: string[] = []

  for (const raw of segments) {
    // Strip outer quotes and shell-escape backslashes
    let p = raw
    if (
      (p.startsWith('"') && p.endsWith('"')) ||
      (p.startsWith("'") && p.endsWith("'"))
    ) {
      p = p.slice(1, -1)
    }
    if (process.platform !== 'win32') {
      p = p.replace(/\\(.)/g, '$1')
    }

    if (!isAbsolute(p)) return []
    // Image files are handled by the upstream image paste handler
    if (isImageFilePath(raw)) return []
    // Verify the path actually exists on disk
    if (!fs.existsSync(p)) return []
    cleaned.push(p)
  }

  return cleaned
}
