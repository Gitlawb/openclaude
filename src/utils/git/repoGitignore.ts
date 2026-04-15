import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Normalizes a gitignore pattern for equivalence comparison.
 * Strips a single trailing slash so that `foo/` and `foo` compare equal.
 */
function normalizePattern(pattern: string): string {
  return pattern.trim().replace(/\/+$/, '')
}

/**
 * Detects the line-ending style of an existing file's content.
 * Returns `\r\n` if the file predominantly uses CRLF, otherwise `\n`.
 */
function detectEol(content: string): '\r\n' | '\n' {
  const crlfCount = (content.match(/\r\n/g) ?? []).length
  const lfCount = (content.match(/\n/g) ?? []).length
  // crlfCount counts \r\n occurrences; lfCount counts all \n (including those in \r\n).
  // If most \n are part of \r\n, treat as CRLF.
  if (crlfCount > 0 && crlfCount === lfCount) return '\r\n'
  return '\n'
}

/**
 * Idempotently appends `pattern` to `<repoRoot>/.gitignore`. Creates the file
 * if it doesn't exist. Considers `foo/` and `foo` equivalent so no duplicate
 * is written. Preserves CRLF line endings if the existing file uses them.
 *
 * @param repoRoot absolute path of repo root (the directory containing .gitignore)
 * @param pattern gitignore pattern to ensure is present (e.g. `.bridgeai/`)
 * @returns `{ added: true }` when the file was modified, `{ added: false }` when no change was needed
 */
export function ensureIgnored(
  repoRoot: string,
  pattern: string,
): { added: boolean } {
  const gitignorePath = join(repoRoot, '.gitignore')
  const normalizedTarget = normalizePattern(pattern)

  if (!existsSync(gitignorePath)) {
    // Create new file with the pattern.
    writeFileSync(gitignorePath, `${pattern}\n`, 'utf-8')
    return { added: true }
  }

  const content = readFileSync(gitignorePath, 'utf-8')
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    if (normalizePattern(line) === normalizedTarget) {
      return { added: false }
    }
  }

  const eol = detectEol(content)
  // Ensure the existing content ends with a newline before appending.
  const needsLeadingEol = content.length > 0 && !content.endsWith('\n')
  const prefix = needsLeadingEol ? eol : ''
  const appended = `${prefix}${pattern}${eol}`
  writeFileSync(gitignorePath, content + appended, 'utf-8')
  return { added: true }
}
