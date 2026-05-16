/**
 * Export format types and helpers for multi-format conversation export.
 */

import { extname, isAbsolute, join } from 'path'

export type ExportFormat = 'text' | 'markdown' | 'json'

/**
 * Normalize a user-provided format string to an ExportFormat.
 * Returns null for unrecognized values.
 */
export function normalizeExportFormat(value: string): ExportFormat | null {
  const lower = value.toLowerCase().trim()
  switch (lower) {
    case 'text':
    case 'txt':
      return 'text'
    case 'markdown':
    case 'md':
      return 'markdown'
    case 'json':
      return 'json'
    default:
      return null
  }
}

/**
 * Infer export format from a filename's extension.
 * Returns null if the extension doesn't map to a known format.
 */
export function inferExportFormatFromFilename(filename: string): ExportFormat | null {
  const ext = extname(filename)
  if (!ext || ext === '.') return null
  return normalizeExportFormat(ext.slice(1))
}

/**
 * Get the canonical file extension for an export format.
 */
export function extensionForExportFormat(format: ExportFormat): '.txt' | '.md' | '.json' {
  switch (format) {
    case 'text':
      return '.txt'
    case 'markdown':
      return '.md'
    case 'json':
      return '.json'
  }
}

/**
 * Ensure a filename has the correct extension for the given export format.
 * Strips any existing extension and appends the canonical one.
 */
export function ensureExportFilenameExtension(
  filename: string,
  format: ExportFormat,
  { preserveMarkdownExtension = false }: { preserveMarkdownExtension?: boolean } = {},
): string {
  const ext = extensionForExportFormat(format)
  const currentExt = extname(filename)
  if (format === 'markdown' && preserveMarkdownExtension && currentExt.toLowerCase() === '.markdown') {
    return filename
  }
  const base = currentExt
    ? filename.slice(0, currentExt === '.' ? -1 : -currentExt.length)
    : filename
  return base + ext
}

export function resolveExportFilepath(cwd: string, filename: string): string {
  return isAbsolute(filename) ? filename : join(cwd, filename)
}

const SUPPORTED_FORMATS = 'Supported formats: text, markdown, json.'

function tokenizeExportArgs(args: string): {
  tokens: Array<{ value: string; quoted: boolean }>
  error?: string
} {
  const tokens: Array<{ value: string; quoted: boolean }> = []
  let current = ''
  let quote: '"' | "'" | null = null
  let tokenStarted = false
  let tokenQuoted = false

  for (let i = 0; i < args.length; i++) {
    const ch = args[i]!

    if (quote) {
      if (ch === quote) {
        quote = null
        continue
      }
      if (quote === '"' && ch === '\\' && i + 1 < args.length) {
        const next = args[i + 1]!
        if (next === '"' || next === '\\') {
          current += next
          i += 1
          continue
        }
      }
      current += ch
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      tokenStarted = true
      tokenQuoted = true
      continue
    }

    if (/\s/.test(ch)) {
      if (tokenStarted) {
        tokens.push({ value: current, quoted: tokenQuoted })
        current = ''
        tokenStarted = false
        tokenQuoted = false
      }
      continue
    }

    current += ch
    tokenStarted = true
  }

  if (quote) {
    return { tokens, error: 'Unterminated quoted string in /export arguments.' }
  }

  if (tokenStarted) {
    tokens.push({ value: current, quoted: tokenQuoted })
  }

  return { tokens }
}

/**
 * Parse /export command arguments.
 *
 * Supported flags:
 *   --format <value>  or  -f <value>
 *
 * Returns parsed filename, format, and optional error string.
 */
export function parseExportArgs(args: string): {
  filename?: string
  format?: ExportFormat
  error?: string
} {
  const tokenized = tokenizeExportArgs(args)
  if (tokenized.error) return { error: tokenized.error }

  const tokens = tokenized.tokens
  if (tokens.length === 0) return {}

  let format: ExportFormat | undefined
  let error: string | undefined
  const filenameTokens: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (!token.quoted && token.value === '--') {
      filenameTokens.push(...tokens.slice(i + 1).map(t => t.value))
      break
    }
    if (!token.quoted && (token.value === '--format' || token.value === '-f')) {
      const value = tokens[++i]?.value
      if (!value) {
        error = `Missing value for ${token.value}. ${SUPPORTED_FORMATS}`
        break
      }
      const normalized = normalizeExportFormat(value)
      if (!normalized) {
        error = `Unsupported export format: ${value}. ${SUPPORTED_FORMATS}`
        break
      }
      format = normalized
    } else if (!token.quoted && token.value.startsWith('-') && token.value !== '-') {
      error = `Unsupported export option: ${token.value}. Supported options: --format, -f.`
      break
    } else {
      filenameTokens.push(token.value)
    }
  }

  const filename = filenameTokens.length > 0 ? filenameTokens.join(' ') : undefined

  if (error) return { filename, format, error }

  return { filename, format }
}
