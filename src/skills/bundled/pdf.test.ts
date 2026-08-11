import { afterAll, beforeAll, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

let pdfgenUrl: string
let pdfgenPath: string

function isEscaped(source: string, index: number): boolean {
  let backslashCount = 0
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) {
    backslashCount++
  }
  return backslashCount % 2 === 1
}

function decodeTemplateContent(raw: string): string {
  let decoded = ''

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\' || i === raw.length - 1) {
      decoded += raw[i]
      continue
    }

    const next = raw[++i]
    if (next === '`' || next === '$' || next === '\\') {
      decoded += next
    } else {
      decoded += `\\${next}`
    }
  }

  return decoded
}

function extractPdfgenSource(source: string): string {
  const assignment = 'const PDFGEN_SOURCE = '
  const assignmentStart = source.indexOf(assignment)

  expect(assignmentStart).toBeGreaterThanOrEqual(0)

  const templateStart = assignmentStart + assignment.length
  expect(source[templateStart]).toBe('`')

  for (let i = templateStart + 1; i < source.length; i++) {
    if (source[i] === '`' && !isEscaped(source, i)) {
      return decodeTemplateContent(source.slice(templateStart + 1, i))
    }
  }

  throw new Error('PDFGEN_SOURCE template literal was not terminated')
}

beforeAll(() => {
  const source = readFileSync(new URL('./pdf.ts', import.meta.url), 'utf8')
  const pdfgenSource = extractPdfgenSource(source)

  pdfgenPath = join(tmpdir(), `openclaude-pdfgen-${randomUUID()}.ts`)
  writeFileSync(pdfgenPath, pdfgenSource)
  pdfgenUrl = pathToFileURL(pdfgenPath).href
})

afterAll(() => {
  if (pdfgenPath) rmSync(pdfgenPath, { force: true })
})

async function importPdfgen() {
  return import(`${pdfgenUrl}?test=${randomUUID()}`) as Promise<{
    createPDF(opts: unknown): Promise<Buffer>
  }>
}

function expectStreamLengthsToMatch(pdf: Buffer): void {
  const text = pdf.toString('latin1')
  const streamPattern = /\/Length (\d+) >>\nstream\n/g
  let match: RegExpExecArray | null
  let count = 0

  while ((match = streamPattern.exec(text)) !== null) {
    count++
    const streamStart = match.index + match[0].length
    const streamEnd = text.indexOf('\nendstream', streamStart)

    expect(streamEnd).toBeGreaterThan(streamStart)
    expect(streamEnd - streamStart).toBe(Number(match[1]))
  }

  expect(count).toBeGreaterThan(0)
}

test('generated PDF streams use matching WinAnsi byte lengths', async () => {
  const { createPDF } = await importPdfgen()
  const pdf = await createPDF({
    title: 'Title — €',
    author: 'Author •',
    pages: [
      {
        content: [
          {
            type: 'paragraph',
            text: 'alpha — beta • gamma €',
          },
          {
            type: 'table',
            headers: ['Header — bullet • euro €'],
            rows: [['row — bullet • euro €']],
          },
        ],
      },
    ],
  })

  expectStreamLengthsToMatch(pdf)
  expect(pdf.includes(Buffer.from('alpha \x97 beta \x95 gamma \x80', 'latin1'))).toBe(
    true,
  )
  expect(pdf.includes(Buffer.from('/Title (Title \x97 \x80)', 'latin1'))).toBe(
    true,
  )
  expect(pdf.includes(Buffer.from([0xc2, 0x97]))).toBe(false)
  expect(pdf.includes(Buffer.from([0xc2, 0x95]))).toBe(false)
  expect(pdf.includes(Buffer.from([0xc2, 0x80]))).toBe(false)
})

test('default orientation controls generated page media box', async () => {
  const { createPDF } = await importPdfgen()
  const pdf = await createPDF({
    defaultPageSize: 'A4',
    defaultOrientation: 'landscape',
    pages: [
      {
        content: [{ type: 'paragraph', text: 'landscape default' }],
      },
    ],
  })

  expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 842 595]')
})

test('bullet list markers are emitted as WinAnsi bullet bytes', async () => {
  const { createPDF } = await importPdfgen()
  const pdf = await createPDF({
    pages: [
      {
        content: [{ type: 'bullet', items: ['hello'] }],
      },
    ],
  })
  const text = pdf.toString('latin1')

  expect(pdf.includes(Buffer.from('\x95  hello', 'latin1'))).toBe(true)
  expect(text).not.toContain('\\2022  hello')
})

test('table headers wrap to fit their columns', async () => {
  const { createPDF } = await importPdfgen()
  const longHeader = 'supercalifragilisticexpialidocious-report-column'
  const pdf = await createPDF({
    pages: [
      {
        content: [
          {
            type: 'table',
            headers: [longHeader],
            rows: [['value']],
            colWidths: [60],
          },
        ],
      },
    ],
  })
  const text = pdf.toString('latin1')
  const headerLineCount = text.match(/BT \/F2 9 Tf/g)?.length ?? 0

  expect(headerLineCount).toBeGreaterThan(1)
  expect(text).not.toContain(longHeader)
})

test('code block background height follows wrapped lines', async () => {
  const { createPDF } = await importPdfgen()
  const pdf = await createPDF({
    pages: [
      {
        content: [{ type: 'code', text: 'x'.repeat(500) }],
      },
    ],
  })
  const text = pdf.toString('latin1')
  const codeLineCount = text.match(/BT \/F5 9 Tf/g)?.length ?? 0
  const rectMatch = text.match(/0\.92 0\.92 0\.92 rg 50 [-\d.]+ 495 ([\d.]+) re f/)

  expect(codeLineCount).toBeGreaterThan(1)
  expect(rectMatch).not.toBeNull()
  expect(Number(rectMatch?.[1])).toBeGreaterThan(24.15)
})

test('code blocks preserve indentation and repeated spaces', async () => {
  const { createPDF } = await importPdfgen()
  const pdf = await createPDF({
    pages: [
      {
        content: [{ type: 'code', text: 'if (ok) {\n    const value  = 1\n}' }],
      },
    ],
  })
  const text = pdf.toString('latin1')

  expect(text).toContain('(    const value  = 1)')
})

test('empty pages or empty content arrays are supported and produce a valid blank page', async () => {
  const { createPDF } = await importPdfgen()
  const pdf = await createPDF({
    pages: [{ content: [] }]
  })
  const text = pdf.toString('latin1')
  expect(text).toContain('/Count 1')
  expect(text).toContain('/MediaBox')

  await expect(createPDF({ pages: [] })).rejects.toThrow('At least one page is required.')
})

test('mismatched table shapes are rejected', async () => {
  const { createPDF } = await importPdfgen()

  // Empty headers
  await expect(createPDF({
    pages: [{
      content: [{ type: 'table', headers: [], rows: [['1', '2']] }]
    }]
  })).rejects.toThrow('Table must have at least one header column.')

  // Extra row cells
  await expect(createPDF({
    pages: [{
      content: [{ type: 'table', headers: ['A'], rows: [['1', '2']] }]
    }]
  })).rejects.toThrow('Table row 0 cell count (2) does not match headers count (1).')

  // Mismatching colWidths length
  await expect(createPDF({
    pages: [{
      content: [{ type: 'table', headers: ['A', 'B'], rows: [['1', '2']], colWidths: [10] }]
    }]
  })).rejects.toThrow('Table colWidths length (1) does not match headers length (2).')
})

test('table headers too tall for page are rejected', async () => {
  const { createPDF } = await importPdfgen()

  // Custom margin that leaves very little room, with many wrapped header lines
  await expect(createPDF({
    pages: [{
      margins: { top: 700, bottom: 100, left: 50, right: 50 },
      pageSize: 'A4', // height is 842, printable is 842 - 700 - 100 - 30 = 12pt
      content: [{
        type: 'table',
        headers: ['extremely long header text that wraps into multiple lines'],
        rows: [['value']],
        colWidths: [40]
      }]
    }]
  })).rejects.toThrow('Table headers are too tall to fit on a single page.')
})

test('table rows flush before rendering below the bottom margin', async () => {
  const { createPDF } = await importPdfgen()
  const pdf = await createPDF({
    pages: [
      {
        margins: { top: 50, right: 50, bottom: 50, left: 50 },
        content: [
          { type: 'spacer', height: 685 },
          { type: 'table', headers: ['A'], rows: [['value']] },
        ],
      },
    ],
  })
  const text = pdf.toString('latin1')
  const rowMatch = text.match(/BT \/F1 9 Tf 54 ([\d.]+) Td \(value\) Tj ET/)

  expect(text).toContain('/Count 2')
  expect(rowMatch).not.toBeNull()
  expect(Number(rowMatch?.[1])).toBeGreaterThan(80)
})

test('importing pdfgen as a library does not run the CLI writer', async () => {
  const testId = randomUUID()
  const specPath = join(tmpdir(), `openclaude-pdf-spec-${testId}.json`)
  const outPath = join(tmpdir(), `openclaude-pdf-output-${testId}.pdf`)
  const originalArgv = process.argv

  writeFileSync(
    specPath,
    JSON.stringify({
      pages: [{ content: [{ type: 'paragraph', text: 'library import only' }] }],
    }),
  )

  try {
    // import.meta.main is the guard under test; argv makes regressions visible.
    process.argv = ['bun', 'consumer.ts', '--spec', specPath, outPath]
    await importPdfgen()
    expect(existsSync(outPath)).toBe(false)
  } finally {
    process.argv = originalArgv
    rmSync(specPath, { force: true })
    rmSync(outPath, { force: true })
  }
})
