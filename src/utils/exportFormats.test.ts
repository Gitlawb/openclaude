import { describe, expect, test } from 'bun:test'

import {
  ensureExportFilenameExtension,
  extensionForExportFormat,
  inferExportFormatFromFilename,
  normalizeExportFormat,
  parseExportArgs,
  resolveExportFilepath,
} from './exportFormats.js'

describe('normalizeExportFormat', () => {
  test('normalizes text variants', () => {
    expect(normalizeExportFormat('text')).toBe('text')
    expect(normalizeExportFormat('txt')).toBe('text')
    expect(normalizeExportFormat('TEXT')).toBe('text')
    expect(normalizeExportFormat(' TxT ')).toBe('text')
  })

  test('normalizes markdown variants', () => {
    expect(normalizeExportFormat('markdown')).toBe('markdown')
    expect(normalizeExportFormat('md')).toBe('markdown')
    expect(normalizeExportFormat('Markdown')).toBe('markdown')
    expect(normalizeExportFormat(' MD ')).toBe('markdown')
  })

  test('normalizes json', () => {
    expect(normalizeExportFormat('json')).toBe('json')
    expect(normalizeExportFormat('JSON')).toBe('json')
    expect(normalizeExportFormat(' Json ')).toBe('json')
  })

  test('returns null for unknown', () => {
    expect(normalizeExportFormat('xml')).toBeNull()
    expect(normalizeExportFormat('')).toBeNull()
    expect(normalizeExportFormat('csv')).toBeNull()
  })
})

describe('inferExportFormatFromFilename', () => {
  test('infers from .txt', () => {
    expect(inferExportFormatFromFilename('a.txt')).toBe('text')
  })

  test('infers from .md', () => {
    expect(inferExportFormatFromFilename('a.md')).toBe('markdown')
  })

  test('infers from .markdown', () => {
    expect(inferExportFormatFromFilename('a.markdown')).toBe('markdown')
  })

  test('infers from .json', () => {
    expect(inferExportFormatFromFilename('a.json')).toBe('json')
  })

  test('returns null for no extension', () => {
    expect(inferExportFormatFromFilename('a')).toBeNull()
  })

  test('returns null for unknown extension', () => {
    expect(inferExportFormatFromFilename('a.csv')).toBeNull()
  })
})

describe('extensionForExportFormat', () => {
  test('returns .txt for text', () => {
    expect(extensionForExportFormat('text')).toBe('.txt')
  })

  test('returns .md for markdown', () => {
    expect(extensionForExportFormat('markdown')).toBe('.md')
  })

  test('returns .json for json', () => {
    expect(extensionForExportFormat('json')).toBe('.json')
  })
})

describe('ensureExportFilenameExtension', () => {
  test('adds extension when none', () => {
    expect(ensureExportFilenameExtension('a', 'text')).toBe('a.txt')
  })

  test('replaces wrong extension for markdown', () => {
    expect(ensureExportFilenameExtension('a.json', 'markdown')).toBe('a.md')
  })

  test('replaces wrong extension for json', () => {
    expect(ensureExportFilenameExtension('a.txt', 'json')).toBe('a.json')
  })

  test('handles name with dots', () => {
    expect(ensureExportFilenameExtension('my.conversation.txt', 'json')).toBe('my.conversation.json')
  })

  test('normalizes trailing dot filenames without duplicating separators', () => {
    expect(ensureExportFilenameExtension('conversation.', 'json')).toBe('conversation.json')
  })

  test('does not treat dots in directory names as filename extensions', () => {
    expect(ensureExportFilenameExtension('logs.v1/transcript', 'json')).toBe('logs.v1/transcript.json')
  })

  test('does not treat a dotfile name as an extension-only filename', () => {
    expect(ensureExportFilenameExtension('.env', 'text')).toBe('.env.txt')
  })

  test('preserves correct extension', () => {
    expect(ensureExportFilenameExtension('a.md', 'markdown')).toBe('a.md')
  })

  test('preserves supported .markdown extension', () => {
    expect(ensureExportFilenameExtension('a.markdown', 'markdown', {
      preserveMarkdownExtension: true,
    })).toBe('a.markdown')
  })

  test('canonicalizes .markdown to .md by default', () => {
    expect(ensureExportFilenameExtension('a.markdown', 'markdown')).toBe('a.md')
  })
})

describe('parseExportArgs', () => {
  test('empty args', () => {
    expect(parseExportArgs('')).toEqual({})
  })

  test('filename only', () => {
    expect(parseExportArgs('transcript.txt')).toEqual({ filename: 'transcript.txt' })
  })

  test('--format json with filename', () => {
    expect(parseExportArgs('--format json transcript')).toEqual({
      format: 'json',
      filename: 'transcript',
    })
  })

  test('-f md with filename', () => {
    expect(parseExportArgs('-f md transcript.txt')).toEqual({
      format: 'markdown',
      filename: 'transcript.txt',
    })
  })

  test('format flag overrides extension', () => {
    const result = parseExportArgs('--format json transcript.txt')
    expect(result.format).toBe('json')
    expect(result.filename).toBe('transcript.txt')
  })

  test('unsupported format returns error', () => {
    const result = parseExportArgs('--format xml transcript')
    expect(result.error).toContain('Unsupported export format: xml')
  })

  test('unsupported dash-prefixed option returns error', () => {
    const result = parseExportArgs('--formt json transcript')
    expect(result.error).toContain('Unsupported export option: --formt')
  })

  test('missing format value returns error', () => {
    const result = parseExportArgs('--format')
    expect(result.error).toContain('Missing value for --format')
  })

  test('-f short form', () => {
    expect(parseExportArgs('-f text conversation')).toEqual({
      format: 'text',
      filename: 'conversation',
    })
  })

  test('format markdown', () => {
    expect(parseExportArgs('--format markdown output')).toEqual({
      format: 'markdown',
      filename: 'output',
    })
  })

  test('preserves filenames with spaces', () => {
    expect(parseExportArgs('my conversation.txt')).toEqual({
      filename: 'my conversation.txt',
    })
  })

  test('preserves filename with spaces and format flag', () => {
    expect(parseExportArgs('--format json my conversation')).toEqual({
      format: 'json',
      filename: 'my conversation',
    })
  })

  test('format flag after filename', () => {
    expect(parseExportArgs('output --format json')).toEqual({
      format: 'json',
      filename: 'output',
    })
  })

  test('parses quoted filenames', () => {
    expect(parseExportArgs('--format json "my conversation"')).toEqual({
      format: 'json',
      filename: 'my conversation',
    })
  })

  test('treats quoted flag-looking tokens as filenames', () => {
    expect(parseExportArgs('"--format"')).toEqual({
      filename: '--format',
    })
  })

  test('supports -- terminator for dash-leading filenames', () => {
    expect(parseExportArgs('-- --format')).toEqual({
      filename: '--format',
    })
  })

  test('parses quoted format values', () => {
    expect(parseExportArgs('--format "md" transcript')).toEqual({
      format: 'markdown',
      filename: 'transcript',
    })
  })

  test('reports unterminated quoted strings', () => {
    const result = parseExportArgs('--format json "my conversation')
    expect(result.error).toContain('Unterminated quoted string')
  })
})

describe('resolveExportFilepath', () => {
  test('resolves relative export filenames under the current working directory', () => {
    expect(resolveExportFilepath('/work/project', 'transcript.md')).toBe('/work/project/transcript.md')
  })

  test('preserves absolute export filenames', () => {
    expect(resolveExportFilepath('/work/project', '/tmp/transcript.md')).toBe('/tmp/transcript.md')
  })
})
