import { registerBundledSkill } from '../bundledSkills.js'

const PDF_SKILL_PROMPT = `# PDF Generation Skill

Generate PDF files entirely in TypeScript — no external binaries or system dependencies required.

## How It Works

When the user asks you to create a PDF, you will:

1. **Write a TypeScript script** that uses the bundled PDF generation library (\`pdfgen.ts\` in the base directory for this skill, shown above)
2. **Execute it** via \`bun run <script>.ts\`

The \`pdfgen.ts\` library provides these functions:

### \`createPDF(options): Promise<Buffer>\`

Creates a PDF from structured content and returns the raw bytes.

**Options:**
\`\`\`ts
interface PDFPage {
  content: PDFElement[]
  pageSize?: 'A4' | 'Letter' | 'A3'
  orientation?: 'portrait' | 'landscape'
  margins?: { top: number; right: number; bottom: number; left: number }  // in points (72 = 1 inch)
}

type PDFElement =
  | { type: 'heading'; text: string; level: 1 | 2 | 3 }
  | { type: 'paragraph'; text: string; align?: 'left' | 'center' | 'right' }
  | { type: 'bullet'; items: string[] }
  | { type: 'numberedList'; items: string[] }
  | { type: 'code'; text: string; language?: string }
  | { type: 'hr' }
  | { type: 'spacer'; height?: number }  // points
  | { type: 'table'; headers: string[]; rows: string[][]; colWidths?: number[] }

interface PDFCreateOptions {
  title?: string
  author?: string
  pages: PDFPage[]
  defaultPageSize?: 'A4' | 'Letter' | 'A3'
  defaultOrientation?: 'portrait' | 'landscape'
  defaultMargins?: { top: number; right: number; bottom: number; left: number }
}
\`\`\`

## Example Workflow

\`\`\`typescript
import { createPDF } from '<skill-base-dir>/pdfgen'
import { writeFileSync } from 'fs'

const pdf = await createPDF({
  title: 'My Report',
  author: 'Claude',
  pages: [{
    content: [
      { type: 'heading', text: 'Q4 Revenue Report', level: 1 },
      { type: 'spacer', height: 12 },
      { type: 'paragraph', text: 'This report covers financial performance for Q4 2025.' },
      { type: 'heading', text: 'Summary', level: 2 },
      { type: 'table', headers: ['Metric', 'Value', 'Change'],
        rows: [['Revenue', '$4.2M', '+12%'], ['Users', '1.8M', '+8%'], ['NPS', '72', '+5']] },
    ]
  }]
})

writeFileSync('report.pdf', pdf)
\`\`\`

## Important Rules

- ALWAYS write a standalone \`.ts\` script and run it with \`bun\`\`, never try to manually construct PDF bytes
- The pdfgen library handles all PDF spec compliance — you only provide structured content
- Content that overflows a single page is automatically continued onto additional pages
- For markdown input, parse it into PDFElement objects rather than passing raw markdown
- Default margins are 50pt (about 0.7 inches) on all sides if not specified
- Default page size is A4
- All text rendering uses built-in Helvetica font variants (Regular, Bold, Italic, BoldItalic)
- Special characters like bullets (\\u2022), em-dashes (\\u2014), and common symbols are supported via WinAnsiEncoding
- When importing \`pdfgen.ts\`, use the absolute base directory path shown above (replace \`<skill-base-dir>\` with the actual path). Do NOT use a relative \`./pdfgen\` import — the library lives in the extracted skill directory, not next to your script
`

export function registerPdfSkill(): void {
  registerBundledSkill({
    name: 'pdf',
    description:
      'Generate PDF documents from structured content. Create reports, formatted documents, tables, and more.',
    whenToUse:
      'Use when the user wants to create, generate, build, or produce a PDF document.',
    argumentHint: '<description of PDF to generate>',
    userInvocable: true,
    allowedTools: ['Bash(bun *)', 'Read', 'Write'],
    files: {
      'pdfgen.ts': PDFGEN_SOURCE,
    },
    async getPromptForCommand(args) {
      let prompt = PDF_SKILL_PROMPT

      if (args) {
        prompt += '\n\n## User Request\n\n' + args
        prompt +=
          '\n\n## Task\n\nWrite a TypeScript script that imports from the pdfgen.ts file using the absolute base directory path shown above (replace `<skill-base-dir>` with the actual extracted path). Save the script in a temporary location or the workspace (not in the skill directory itself), run it with bun, and report the output path.'
      }

      return [{ type: 'text', text: prompt }]
    },
  })
}

// ─── Minimal PDF generator in pure TypeScript ───
// No external dependencies. Generates valid PDF 1.4.

const PDFGEN_SOURCE = `// pdfgen.ts — Pure TypeScript PDF generation (PDF 1.4)
// No external dependencies. Supports automatic multi-page continuation.

import { readFileSync, writeFileSync } from 'fs'

// ─── Types ───

export interface PDFPage {
  content: PDFElement[]
  pageSize?: 'A4' | 'Letter' | 'A3'
  orientation?: 'portrait' | 'landscape'
  margins?: { top: number; right: number; bottom: number; left: number }
}

export interface PDFCreateOptions {
  title?: string
  author?: string
  pages: PDFPage[]
  defaultPageSize?: 'A4' | 'Letter' | 'A3'
  defaultOrientation?: 'portrait' | 'landscape'
  defaultMargins?: { top: number; right: number; bottom: number; left: number }
}

export type PDFElement =
  | { type: 'heading'; text: string; level: 1 | 2 | 3 }
  | { type: 'paragraph'; text: string; align?: 'left' | 'center' | 'right' }
  | { type: 'bullet'; items: string[] }
  | { type: 'numberedList'; items: string[] }
  | { type: 'code'; text: string; language?: string }
  | { type: 'hr' }
  | { type: 'spacer'; height?: number }
  | { type: 'table'; headers: string[]; rows: string[][]; colWidths?: number[] }

// ─── Constants ───

const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [595, 842],
  Letter: [612, 792],
  A3: [842, 1191],
}

const DEFAULT_MARGINS = { top: 50, right: 50, bottom: 50, left: 50 }

const FONTS = {
  'Helvetica': 'F1',
  'Helvetica-Bold': 'F2',
  'Helvetica-Oblique': 'F3',
  'Helvetica-BoldOblique': 'F4',
  'Courier': 'F5',
  'Courier-Bold': 'F6',
  'Courier-Oblique': 'F7',
  'Courier-BoldOblique': 'F8',
} as const

const FONT_SIZES: Record<number, number> = { 1: 20, 2: 15, 3: 12 }
const LINE_HEIGHT = 1.35
const CODE_FONT_SIZE = 9
const PDF_BYTE_ENCODING = 'latin1'

function pdfBytes(text: string): Buffer {
  return Buffer.from(text, PDF_BYTE_ENCODING)
}

// ─── WinAnsi helpers ───

function toWinAnsi(text: string): string {
  const map: Record<number, number> = {
    0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92,
    0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2026: 0x85,
    0x201a: 0x82, 0x201e: 0x84, 0x2030: 0x89, 0x2039: 0x8b,
    0x203a: 0x9b, 0x2032: 0x92, 0x2033: 0x94,
    0x00a0: 0xa0, 0x00a1: 0xa1, 0x00a2: 0xa2, 0x00a3: 0xa3,
    0x20ac: 0x80, 0x0160: 0x8a, 0x0161: 0x9a, 0x0178: 0x9f,
    0x017d: 0x8e, 0x017e: 0x9e,
  }
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 32 && code <= 126) {
      out += text[i]
    } else if (code === 10) {
      out += '\\n'
    } else if (map[code] !== undefined) {
      out += String.fromCharCode(map[code])
    }
    // skip unsupported characters
  }
  return out
}

function escapePdf(str: string): string {
  // str is already WinAnsi-encoded; only escape PDF reserved chars
  return str
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/\\(/g, '\\\\(')
    .replace(/\\)/g, '\\\\)')
}

// ─── PDF text measurement (approximate) ───

function measureText(text: string, fontSize: number, font: string = 'Helvetica'): number {
  // Helvetica average char width is ~0.52 * fontSize
  const charWidth = font.startsWith('Courier') ? 0.6 * fontSize : 0.52 * fontSize
  let maxLine = 0
  for (const line of text.split('\\n')) {
    const w = line.length * charWidth
    if (w > maxLine) maxLine = w
  }
  return maxLine
}

function wrapText(text: string, maxWidth: number, fontSize: number, font: string = 'Helvetica'): string[] {
  const charWidth = font.startsWith('Courier') ? 0.6 * fontSize : 0.52 * fontSize
  const charsPerLine = Math.max(1, Math.floor(maxWidth / charWidth))
  const words = text.split(/\\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (!current) {
      current = word
    } else if ((current + ' ' + word).length > charsPerLine) {
      lines.push(current)
      current = word
    } else {
      current += ' ' + word
    }
  }
  if (current) lines.push(current)
  // Hard-split any line that still exceeds charsPerLine (handles long URLs, IDs, hashes)
  const result: string[] = []
  for (const line of lines) {
    if (line.length <= charsPerLine) {
      result.push(line)
    } else {
      let remaining = line
      while (remaining.length > 0) {
        result.push(remaining.substring(0, charsPerLine))
        remaining = remaining.substring(charsPerLine)
      }
    }
  }
  return result.length ? result : ['']
}

function wrapCodeLine(line: string, maxWidth: number, fontSize: number): string[] {
  const charWidth = 0.6 * fontSize
  const charsPerLine = Math.max(1, Math.floor(maxWidth / charWidth))
  const result: string[] = []
  for (let i = 0; i < line.length; i += charsPerLine) {
    result.push(line.substring(i, i + charsPerLine))
  }
  return result.length ? result : ['']
}

// ─── Low-level PDF builder ───

class PDFWriter {
  build(opts: PDFCreateOptions): Buffer {
    // Collect all body objects (object 3 and beyond).
    // Object 1 = Catalog, Object 2 = Pages (hardcoded below).
    const bodyObjects: string[] = []
    const pageObjPdfNums: number[] = []

    // Object 3–10: Font dictionaries (one per variant)
    const fontNames = [
      'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
      'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
    ]
    for (const name of fontNames) {
      bodyObjects.push(
        \`<< /Type /Font /Subtype /Type1 /BaseFont /\${name} /Encoding /WinAnsiEncoding >>\`
      )
    }
    // Font objects are at pdf nums 3..10 (index 0..7 → obj num 3..10)
    const FONT_OBJ_START = 3

    if (!opts.pages || opts.pages.length === 0) {
      throw new Error('At least one page is required.')
    }

    // Build per-page objects (with automatic overflow pagination)
    for (const page of opts.pages) {
      const size = PAGE_SIZES[page.pageSize || opts.defaultPageSize || 'A4']
      const orientation = page.orientation || opts.defaultOrientation || 'portrait'
      const [pw, ph] = orientation === 'landscape' ? [size[1], size[0]] : size
      const m = page.margins || opts.defaultMargins || DEFAULT_MARGINS
      const contentW = pw - m.left - m.right

      // buildPageStreams returns an array of content streams — one per
      // physical PDF page.  Content that overflows a single page is
      // automatically continued onto additional pages.
      const pageStreams = buildPageStreams(page.content, ph, m, contentW)

      for (const { stream } of pageStreams) {
        // Content-stream object
        const streamPdfNum = bodyObjects.length + 3
        bodyObjects.push(stream)

        // Page object — each font name maps to a distinct object (3..10)
        pageObjPdfNums.push(bodyObjects.length + 3)
        bodyObjects.push(
          \`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 \${pw} \${ph}]\` +
          \`\\n   /Contents \${streamPdfNum} 0 R\` +
          \`\\n   /Resources << /Font << /F1 \${FONT_OBJ_START} 0 R /F2 \${FONT_OBJ_START + 1} 0 R /F3 \${FONT_OBJ_START + 2} 0 R /F4 \${FONT_OBJ_START + 3} 0 R /F5 \${FONT_OBJ_START + 4} 0 R /F6 \${FONT_OBJ_START + 5} 0 R /F7 \${FONT_OBJ_START + 6} 0 R /F8 \${FONT_OBJ_START + 7} 0 R >> >> >>\`
        )
      }
    }

    // Info dictionary
    const infoPdfNum = bodyObjects.length + 3
    bodyObjects.push(buildInfoDict(opts.title, opts.author))

    // Assemble the final PDF
    const parts: Buffer[] = []
    const objPositions: number[] = []

    // Header
    parts.push(pdfBytes('%PDF-1.4\\n%\\xe2\\xe3\\xcf\\xd3\\n'))

    // Object 1: Catalog
    objPositions.push(getBufLen(parts))
    parts.push(pdfBytes(\`1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n\`))

    // Object 2: Pages
    objPositions.push(getBufLen(parts))
    const kids = pageObjPdfNums.map(n => \`\${n} 0 R\`).join(' ')
    parts.push(pdfBytes(\`2 0 obj\\n<< /Type /Pages /Kids [\${kids}] /Count \${pageObjPdfNums.length} >>\\nendobj\\n\`))

    // Objects 3+: body objects (font, streams, pages, info)
    for (let i = 0; i < bodyObjects.length; i++) {
      const objNum = i + 3
      objPositions.push(getBufLen(parts))
      parts.push(pdfBytes(\`\${objNum} 0 obj\\n\`))
      parts.push(pdfBytes(bodyObjects[i]))
      parts.push(pdfBytes('\\nendobj\\n'))
    }

    const totalObjs = 2 + bodyObjects.length

    // Cross-reference table
    const xrefOffset = getBufLen(parts)
    parts.push(pdfBytes(\`xref\\n0 \${totalObjs + 1}\\n\`))
    parts.push(pdfBytes('0000000000 65535 f \\n'))
    for (const pos of objPositions) {
      parts.push(pdfBytes(\`\${String(pos).padStart(10, '0')} 00000 n \\n\`))
    }

    // Trailer
    parts.push(pdfBytes(
      \`trailer\\n<< /Size \${totalObjs + 1} /Root 1 0 R /Info \${infoPdfNum} 0 R >>\\nstartxref\\n\${xrefOffset}\\n%%EOF\\n\`
    ))

    return Buffer.concat(parts)
  }
}


function getBufLen(parts: Buffer[]): number {
  let total = 0
  for (const p of parts) total += p.length
  return total
}

// Font dict is now built inline in PDFWriter.build (one object per variant)
function buildInfoDict(title?: string, author?: string): string {
  let s = '<< '
  if (title) s += \`/Title (\${escapePdf(toWinAnsi(title))}) \`
  if (author) s += \`/Author (\${escapePdf(toWinAnsi(author))}) \`
  s += '/Producer (pdfgen.ts) >>'
  return s
}

interface PageStreamResult {
  stream: string
}

/**
 * Build content streams for a set of elements, automatically overflowing
 * onto new pages when content exceeds the available vertical space.
 * Returns one PageStreamResult per physical PDF page.
 */
function buildPageStreams(
  elements: PDFElement[],
  pageH: number,
  margins: { top: number; right: number; bottom: number; left: number },
  contentW: number
): PageStreamResult[] {
  const results: PageStreamResult[] = []
  let lines: string[] = []
  let y = pageH - margins.top
  const maxY = margins.bottom + 30

  const flushPage = () => {
    const streamContent = lines.join('\\n')
    const streamBuf = pdfBytes(streamContent)
    results.push({
      stream: \`<< /Length \${streamBuf.length} >>\\nstream\\n\${streamContent}\\nendstream\`
    })
    lines = []
    y = pageH - margins.top
  }

  for (const el of elements) {
    switch (el.type) {
      case 'heading': {
        const size = FONT_SIZES[el.level] || 12
        const font = 'Helvetica-Bold'
        const wrapped = wrapText(toWinAnsi(el.text), contentW, size, font)
        const lh = size * LINE_HEIGHT
        y -= lh
        for (const line of wrapped) {
          if (y < maxY) {
            flushPage()
            y -= lh
          }
          lines.push(\`BT /F2 \${size} Tf \${margins.left} \${y} Td (\${escapePdf(line)}) Tj ET\`)
          y -= lh
        }
        y -= 4
        break
      }
      case 'paragraph': {
        const size = 10
        const align = el.align || 'left'
        const wrapped = wrapText(toWinAnsi(el.text), contentW, size)
        const lh = size * LINE_HEIGHT
        for (const line of wrapped) {
          if (y < maxY) {
            flushPage()
            y -= lh
          }
          let x = margins.left
          if (align === 'center') {
            const tw = measureText(line, size)
            x = margins.left + (contentW - tw) / 2
          } else if (align === 'right') {
            const tw = measureText(line, size)
            x = margins.left + contentW - tw
          }
          lines.push(\`BT /F1 \${size} Tf \${x.toFixed(1)} \${y.toFixed(1)} Td (\${escapePdf(line)}) Tj ET\`)
          y -= lh
        }
        y -= 4
        break
      }
      case 'bullet': {
        const size = 10
        const lh = size * LINE_HEIGHT
        const bulletPrefix = toWinAnsi('•  ')
        y -= 2
        for (const item of el.items) {
          const wrapped = wrapText(toWinAnsi(item), contentW - 20, size)
          for (let i = 0; i < wrapped.length; i++) {
            if (y < maxY) {
              flushPage()
              y -= lh
            }
            const prefix = i === 0 ? bulletPrefix : '   '
            lines.push(\`BT /F1 \${size} Tf \${margins.left} \${y.toFixed(1)} Td (\${escapePdf(prefix + wrapped[i])}) Tj ET\`)
            y -= lh
          }
        }
        y -= 4
        break
      }
      case 'numberedList': {
        const size = 10
        const lh = size * LINE_HEIGHT
        y -= 2
        for (let idx = 0; idx < el.items.length; idx++) {
          const wrapped = wrapText(toWinAnsi(el.items[idx]), contentW - 25, size)
          const num = \`\${idx + 1}. \`
          for (let i = 0; i < wrapped.length; i++) {
            if (y < maxY) {
              flushPage()
              y -= lh
            }
            const prefix = i === 0 ? num : ' '.repeat(num.length)
            lines.push(\`BT /F1 \${size} Tf \${margins.left} \${y.toFixed(1)} Td (\${escapePdf(prefix + wrapped[i])}) Tj ET\`)
            y -= lh
          }
        }
        y -= 4
        break
      }
      case 'code': {
        const size = CODE_FONT_SIZE
        const lh = size * LINE_HEIGHT
        const codeAvailW = contentW - 12
        const codeLines = toWinAnsi(el.text).split('\\n')
        const wrappedCodeLines: string[] = []
        for (const rawLine of codeLines) {
          wrappedCodeLines.push(...wrapCodeLine(rawLine, codeAvailW, size))
        }

        y -= 6
        let lineIndex = 0
        while (lineIndex < wrappedCodeLines.length) {
          if (y - (lh + 12) < maxY) {
            if (lines.length > 0) {
              flushPage()
            }
            y -= 6
          }

          const maxLinesThisPage = Math.max(1, Math.floor((y - maxY - 12) / lh))
          const linesToRender = Math.min(maxLinesThisPage, wrappedCodeLines.length - lineIndex)
          const boxH = linesToRender * lh + 12
          lines.push(\`0.92 0.92 0.92 rg \${margins.left} \${y - boxH + 6} \${contentW} \${boxH} re f\`)
          y -= 6
          lines.push('0 0 0 rg')

          for (let i = 0; i < linesToRender; i++) {
            const codeLine = wrappedCodeLines[lineIndex + i]
            lines.push(\`BT /F5 \${size} Tf \${margins.left + 6} \${y.toFixed(1)} Td (\${escapePdf(codeLine)}) Tj ET\`)
            y -= lh
          }

          lineIndex += linesToRender
          y -= 6
          lines.push('0 0 0 rg')
          if (lineIndex < wrappedCodeLines.length) {
            flushPage()
            y -= 6
          }
        }
        break
      }
      case 'hr': {
        y -= 8
        if (y < maxY) {
          flushPage()
          y -= 8
        }
        const lineY = y + 2
        lines.push(\`0.8 0.8 0.8 RG 0.5 w \${margins.left} \${lineY} \${contentW} 0 re S\`)
        y -= 8
        break
      }
      case 'spacer': {
        y -= el.height || 12
        if (y < maxY) {
          flushPage()
        }
        break
      }
      case 'table': {
        const size = 9
        const lh = size * LINE_HEIGHT
        const cols = el.headers.length
        if (cols === 0) {
          throw new Error('Table must have at least one header column.')
        }
        if (el.colWidths && el.colWidths.length !== cols) {
          throw new Error(\`Table colWidths length (\${el.colWidths.length}) does not match headers length (\${cols}).\`)
        }
        for (let r = 0; r < el.rows.length; r++) {
          if (el.rows[r].length !== cols) {
            throw new Error(\`Table row \${r} cell count (\${el.rows[r].length}) does not match headers count (\${cols}).\`)
          }
        }
        const colW = el.colWidths || el.headers.map(() => contentW / cols)
        const headerWrapped: string[][] = []
        let maxHeaderLines = 1
        for (let c = 0; c < cols; c++) {
          const hl = wrapText(toWinAnsi(el.headers[c] || ''), colW[c] - 8, size, 'Helvetica-Bold')
          headerWrapped.push(hl)
          if (hl.length > maxHeaderLines) maxHeaderLines = hl.length
        }
        const headerH = maxHeaderLines * lh + 6
        if (headerH > (pageH - margins.top - maxY)) {
          throw new Error('Table headers are too tall to fit on a single page.')
        }

        // Header row
        y -= headerH
        if (y < maxY) {
          flushPage()
          y -= headerH
        }
        lines.push(\`0.15 0.15 0.15 rg \${margins.left} \${y} \${contentW} \${headerH} re f\`)
        lines.push('1 1 1 rg')
        let x = margins.left
        const headerStartY = y + headerH - 4
        for (let c = 0; c < cols; c++) {
          for (let li = 0; li < headerWrapped[c].length; li++) {
            lines.push(\`BT /F2 \${size} Tf \${x + 4} \${(headerStartY - li * lh).toFixed(1)} Td (\${escapePdf(headerWrapped[c][li])}) Tj ET\`)
          }
          x += colW[c]
        }
        lines.push('0 0 0 rg')

        for (let r = 0; r < el.rows.length; r++) {
          const row = el.rows[r]
          // Pre-compute wrapped lines for each cell
          const cellWrapped: string[][] = []
          let maxCellLines = 1
          for (let c = 0; c < cols; c++) {
            const cl = wrapText(toWinAnsi(row[c] || ''), colW[c] - 8, size)
            cellWrapped.push(cl)
            if (cl.length > maxCellLines) maxCellLines = cl.length
          }
          // Render row in page-sized chunks to handle rows taller than one page
          let linesRendered = 0
          while (linesRendered < maxCellLines) {
            if (y - (lh + 6) < maxY) {
              flushPage()
            }
            const availH = y - maxY
            const maxLinesThisPage = Math.max(1, Math.floor((availH - 6) / lh))
            const linesToRender = Math.min(maxLinesThisPage, maxCellLines - linesRendered)
            const chunkH = linesToRender * lh + 6
            y -= chunkH
            if (r % 2 === 0) {
              lines.push(\`0.96 0.96 0.96 rg \${margins.left} \${y} \${contentW} \${chunkH} re f\`)
            }
            lines.push(\`0.85 0.85 0.85 RG 0.3 w \${margins.left} \${y} \${contentW} 0 re S\`)
            lines.push('0 0 0 rg')
            let x = margins.left
            const cellStartY = y + chunkH - 4
            for (let c = 0; c < cols; c++) {
              for (let li = 0; li < linesToRender; li++) {
                const cellLineIdx = linesRendered + li
                if (cellLineIdx < cellWrapped[c].length) {
                  lines.push(\`BT /F1 \${size} Tf \${x + 4} \${(cellStartY - li * lh).toFixed(1)} Td (\${escapePdf(cellWrapped[c][cellLineIdx])}) Tj ET\`)
                }
              }
              x += colW[c]
            }
            linesRendered += linesToRender
            if (linesRendered < maxCellLines) {
              flushPage()
            }
          }
        }
        y -= 2
        lines.push(\`0.6 0.6 0.6 RG 0.5 w \${margins.left} \${y + 2} \${contentW} 0 re S\`)
        y -= 6
        break
      }
    }
  }

  // Flush remaining content as the last page
  if (lines.length > 0) {
    flushPage()
  }

  if (results.length === 0) {
    const streamContent = ''
    const streamBuf = pdfBytes(streamContent)
    results.push({
      stream: \`<< /Length \${streamBuf.length} >>\\nstream\\n\${streamContent}\\nendstream\`
    })
  }

  return results
}

// ─── Public API ───

export async function createPDF(opts: PDFCreateOptions): Promise<Buffer> {
  const writer = new PDFWriter()
  return writer.build(opts)
}


// ─── CLI ───

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length > 0) {
    // Simple CLI: bun pdfgen.ts <output.pdf>
    // Reads a JSON spec from stdin or a file
    const nonFlags = args.filter(a => !a.startsWith('--'))
    let specFile: string | undefined
    if (args.includes('--spec')) {
      specFile = args[args.indexOf('--spec') + 1]
    }
    // outFile is the last non-flag arg that is not the spec file
    const outFile = nonFlags.filter(a => a !== specFile).pop()
    if (!outFile) {
      process.stderr.write('Usage: bun pdfgen.ts [--spec <file>] <output.pdf>\\n')
      process.exit(1)
    }
    let spec: PDFCreateOptions
    if (specFile) {
      spec = JSON.parse(readFileSync(specFile, 'utf-8'))
    } else {
      // Read from stdin
      const input = readFileSync(0, 'utf-8')
      spec = JSON.parse(input)
    }
    const pdf = await createPDF(spec)
    writeFileSync(outFile, pdf)
    process.stderr.write(\`PDF written to \${outFile} (\${pdf.length} bytes)\\n\`)
  }
}
`
