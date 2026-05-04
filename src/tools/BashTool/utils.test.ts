import { describe, expect, test } from 'bun:test'
import {
  stripEmptyLines,
  isImageOutput,
  parseDataUri,
  formatOutput,
  createContentSummary,
} from './utils.js'

// =============================================================================
// stripEmptyLines — removes leading/trailing blank lines
// =============================================================================

describe('stripEmptyLines', () => {
  test('strips leading empty lines', () => {
    expect(stripEmptyLines('\n\n\nhello')).toBe('hello')
  })

  test('strips trailing empty lines', () => {
    expect(stripEmptyLines('hello\n\n\n')).toBe('hello')
  })

  test('strips both ends', () => {
    expect(stripEmptyLines('\n\nhello\n\n')).toBe('hello')
  })

  test('preserves internal empty lines', () => {
    expect(stripEmptyLines('a\n\nb')).toBe('a\n\nb')
  })

  test('all empty lines returns empty string', () => {
    expect(stripEmptyLines('\n\n\n')).toBe('')
  })

  test('empty string returns empty string', () => {
    expect(stripEmptyLines('')).toBe('')
  })

  test('preserves whitespace-only lines in the middle', () => {
    expect(stripEmptyLines('a\n   \nb')).toBe('a\n   \nb')
  })

  test('single line no change', () => {
    expect(stripEmptyLines('hello')).toBe('hello')
  })
})

// =============================================================================
// isImageOutput — detects base64 data URIs
// =============================================================================

describe('isImageOutput', () => {
  test('detects PNG data URI', () => {
    expect(isImageOutput('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
  })

  test('detects JPEG data URI', () => {
    expect(isImageOutput('data:image/jpeg;base64,/9j/4AAQ')).toBe(true)
  })

  test('detects GIF data URI', () => {
    expect(isImageOutput('data:image/gif;base64,R0lGODlhAQABAIAAAP')).toBe(true)
  })

  test('detects SVG data URI', () => {
    expect(isImageOutput('data:image/svg+xml;base64,PHN2Zz4=')).toBe(true)
  })

  test('rejects plain text', () => {
    expect(isImageOutput('hello world')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(isImageOutput('')).toBe(false)
  })

  test('rejects non-image data URI', () => {
    expect(isImageOutput('data:text/plain;base64,aGVsbG8=')).toBe(false)
  })

  test('rejects partial data URI', () => {
    expect(isImageOutput('data:image/png,')).toBe(false)
  })
})

// =============================================================================
// parseDataUri — extracts media type and base64 payload
// =============================================================================

describe('parseDataUri', () => {
  test('parses valid PNG data URI', () => {
    const result = parseDataUri('data:image/png;base64,iVBORw0KGgo=')
    expect(result).toEqual({
      mediaType: 'image/png',
      data: 'iVBORw0KGgo=',
    })
  })

  test('parses valid JPEG data URI', () => {
    const result = parseDataUri('data:image/jpeg;base64,/9j/4AAQ')
    expect(result).toEqual({
      mediaType: 'image/jpeg',
      data: '/9j/4AAQ',
    })
  })

  test('handles whitespace around URI', () => {
    const result = parseDataUri('  data:image/png;base64,abc123  ')
    expect(result).toEqual({
      mediaType: 'image/png',
      data: 'abc123',
    })
  })

  test('returns null for non-data URI', () => {
    expect(parseDataUri('https://example.com/image.png')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(parseDataUri('')).toBeNull()
  })

  test('returns null for incomplete data URI', () => {
    expect(parseDataUri('data:image/png')).toBeNull()
  })

  test('returns null for non-base64 data URI', () => {
    expect(parseDataUri('data:text/plain,hello')).toBeNull()
  })
})

// =============================================================================
// formatOutput — truncates long output with line count
// =============================================================================

describe('formatOutput', () => {
  test('short output passes through unchanged', () => {
    const result = formatOutput('line1\nline2\nline3')
    expect(result.truncatedContent).toBe('line1\nline2\nline3')
    expect(result.totalLines).toBe(3)
    expect(result.isImage).toBe(false)
  })

  test('empty output', () => {
    const result = formatOutput('')
    expect(result.truncatedContent).toBe('')
    expect(result.totalLines).toBe(1)
  })

  test('image output is passed through', () => {
    const img = 'data:image/png;base64,iVBORw0KGgo='
    const result = formatOutput(img)
    expect(result.truncatedContent).toBe(img)
    expect(result.totalLines).toBe(1)
    expect(result.isImage).toBe(true)
  })

  test('single line no trailing newline', () => {
    const result = formatOutput('hello')
    expect(result.totalLines).toBe(1)
  })
})

// =============================================================================
// createContentSummary — MCP content block summaries
// =============================================================================

describe('createContentSummary', () => {
  test('summarizes text blocks', () => {
    const content = [
      { type: 'text' as const, text: 'Hello world' },
    ]
    const result = createContentSummary(content)
    expect(result).toContain('MCP Result')
    expect(result).toContain('1 text block')
    expect(result).toContain('Hello world')
  })

  test('summarizes image blocks', () => {
    const content = [
      { type: 'image' as const, data: 'base64data', mimeType: 'image/png' },
    ]
    const result = createContentSummary(content as any)
    expect(result).toContain('1 image')
  })

  test('summarizes mixed content', () => {
    const content = [
      { type: 'text' as const, text: 'Description' },
      { type: 'image' as const, data: 'base64data', mimeType: 'image/png' },
      { type: 'text' as const, text: 'More text' },
    ]
    // @ts-expect-error argument type mismatch
    const result = createContentSummary(content)
    expect(result).toContain('1 image')
    expect(result).toContain('2 text blocks')
  })

  test('truncates long text preview at 200 chars', () => {
    const longText = 'x'.repeat(300)
    const content = [
      { type: 'text' as const, text: longText },
    ]
    const result = createContentSummary(content)
    expect(result).toContain('...')
    expect(result).toContain('x'.repeat(200))
  })

  test('empty content array', () => {
    const result = createContentSummary([])
    expect(result).toContain('MCP Result')
  })
})
