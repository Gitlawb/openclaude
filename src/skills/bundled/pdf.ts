import { registerBundledSkill } from '../bundledSkills.js'

const PDF_SKILL_PROMPT = `# PDF Generation Skill

Generate PDF files entirely in TypeScript — no external binaries or system dependencies required.

## How It Works

When the user asks you to create a PDF, you will:

1. **Write a TypeScript script** that uses the bundled PDF generation library at \`\`\${CLAUDE_SKILL_DIR}/pdfgen.ts\`\`\`
2. **Execute it** via \`bun run <script>.ts\`

The \`pdfgen.ts\`\` library provides these functions:

### \`createPDF(options): Promise<Buffer>\`

Creates a PDF from structured content and returns the raw bytes.

**Options:**
\`\`\`ts
interface PDFPage {
  content: PDFElement[]
  header?: string       // optional page header text
  footer?: string       // optional page footer text
  pageSize?: 'A4' | 'Letter' | 'A3'
  orientation?: 'portrait' | 'landscape'
  margins?: { top: number; right: number; bottom: number; left: number }  // in points (72 = 1 inch)
}

interface PDFElement =
  | { type: 'heading'; text: string; level: 1 | 2 | 3 }
  | { type: 'paragraph'; text: string; align?: 'left' | 'center' | 'right' }
  | { type: 'bullet'; items: string[] }
  | { type: 'numberedList'; items: string[] }
  | { type: 'code'; text: string; language?: string }
  | { type: 'hr' }
  | { type: 'spacer'; height?: number }  // points
  | { type: 'table'; headers: string[]; rows: string[][]; colWidths?: number[] }
  | { type: 'image'; path: string; width?: number; height?: number }  // width/height in points

interface PDFCreateOptions {
  title?: string
  author?: string
  pages: PDFPage[]
  defaultPageSize?: 'A4' | 'Letter'
  defaultOrientation?: 'portrait' | 'landscape'
  defaultMargins?: { top: number; right: number; bottom: number; left: number }
}
\`\`\`

## Example Workflow

\`\`\`typescript
import { createPDF } from '\${CLAUDE_SKILL_DIR}/pdfgen'
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

- ALWAYS write a standalone \`.ts\`\` script and run it with \`bun\`\`, never try to manually construct PDF bytes
- The pdfgen library handles all PDF spec compliance — you only provide structured content
- Use relative paths for images; they must exist on disk before calling createPDF
- For markdown input, parse it into PDFElement objects rather than passing raw markdown
- Default margins are 50pt (about 0.7 inches) on all sides if not specified
- Default page size is A4
- All text rendering uses built-in Helvetica font variants (Regular, Bold, Italic, BoldItalic)
- Special characters like bullets (\\u2022), em-dashes (\\u2014), and common symbols are supported via WinAnsiEncoding
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
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit'],
    files: {
      'pdfgen.ts': PDFGEN_SOURCE,
    },
    async getPromptForCommand(args) {
      let prompt = PDF_SKILL_PROMPT

      if (args) {
        prompt += '\n\n## User Request\n\n' + args
        prompt +=
          '\n\n## Task\n\nWrite a TypeScript script that uses the pdfgen library at ${CLAUDE_SKILL_DIR}/pdfgen.ts to generate the requested PDF. Save the script, run it with bun, and report the output path.'
      }

      return [{ type: 'text', text: prompt }]
    },
  })
}

// ─── Minimal PDF generator in pure TypeScript ───
// No external dependencies. Generates valid PDF 1.4.

const PDFGEN_SOURCE = `// pdfgen.ts — Pure TypeScript PDF generation (PDF 1.4)
// No external dependencies. ~350 lines.

import { readFileSync, writeFileSync } from 'fs'
import { basename } from 'path'

// ─── Types ───

export interface PDFPage {
  content: PDFElement[]
  header?: string
  footer?: string
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
  | { type: 'image'; path: string; width?: number; height?: number }

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
  return toWinAnsi(str)
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
  return lines.length ? lines : ['']
}

// ─── Low-level PDF builder ───

class PDFWriter {
  build(opts: PDFCreateOptions): Buffer {
    // Collect all body objects (object 3 and beyond).
    // Object 1 = Catalog, Object 2 = Pages (hardcoded below).
    const bodyObjects: string[] = []
    const pageObjPdfNums: number[] = []

    // Object 3: Font dictionary
    bodyObjects.push(buildFontDict())

    // Build per-page objects
    for (const page of opts.pages) {
      const size = PAGE_SIZES[page.pageSize || opts.defaultPageSize || 'A4']
      const [pw, ph] = page.orientation === 'landscape' ? [size[1], size[0]] : size
      const m = page.margins || opts.defaultMargins || DEFAULT_MARGINS
      const contentW = pw - m.left - m.right

      const { stream, images } = buildPageStream(page.content, pw, ph, m, contentW)

      // Image XObject entries (if any)
      const pageImagePdfNums: number[] = []
      for (const img of images) {
        pageImagePdfNums.push(bodyObjects.length + 3)
        bodyObjects.push(img.xobj)
      }

      // Content-stream object
      const streamPdfNum = bodyObjects.length + 3
      bodyObjects.push(stream)

      // Build XObject resource string
      const imgXObjects = pageImagePdfNums
        .map((num, idx) => \`/Img\${idx} \${num} 0 R\`)
        .join(' ')
      const xobjStr = imgXObjects.length
        ? \`\\n    << \${imgXObjects} >>\`
        : ''

      // Page object
      const fontPdfNum = 3
      pageObjPdfNums.push(bodyObjects.length + 3)
      bodyObjects.push(
        \`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 \${pw} \${ph}]\` +
        \`\\n   /Contents \${streamPdfNum} 0 R\` +
        \`\\n   /Resources << /Font << /F1 \${fontPdfNum} 0 R /F2 \${fontPdfNum} 0 R /F3 \${fontPdfNum} 0 R /F4 \${fontPdfNum} 0 R /F5 \${fontPdfNum} 0 R /F6 \${fontPdfNum} 0 R /F7 \${fontPdfNum} 0 R /F8 \${fontPdfNum} 0 R >> /XObject <<\${xobjStr ? xobjStr.slice(4) : ''} >> >> >>\`
      )
    }

    // Info dictionary
    const infoPdfNum = bodyObjects.length + 3
    bodyObjects.push(buildInfoDict(opts.title, opts.author))

    // Assemble the final PDF
    const parts: Buffer[] = []
    const objPositions: number[] = []

    // Header
    parts.push(Buffer.from('%PDF-1.4\\n%\\xe2\\xe3\\xcf\\xd3\\n'))

    // Object 1: Catalog
    objPositions.push(getBufLen(parts))
    parts.push(Buffer.from(\`1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n\`))

    // Object 2: Pages
    objPositions.push(getBufLen(parts))
    const kids = pageObjPdfNums.map(n => \`\${n} 0 R\`).join(' ')
    parts.push(Buffer.from(\`2 0 obj\\n<< /Type /Pages /Kids [\${kids}] /Count \${pageObjPdfNums.length} >>\\nendobj\\n\`))

    // Objects 3+: body objects (font, streams, pages, images, info)
    for (let i = 0; i < bodyObjects.length; i++) {
      const objNum = i + 3
      objPositions.push(getBufLen(parts))
      parts.push(Buffer.from(\`\${objNum} 0 obj\\n\`))
      parts.push(Buffer.from(bodyObjects[i]))
      parts.push(Buffer.from('\\nendobj\\n'))
    }

    const totalObjs = 2 + bodyObjects.length

    // Cross-reference table
    const xrefOffset = getBufLen(parts)
    parts.push(Buffer.from(\`xref\\n0 \${totalObjs + 1}\\n\`))
    parts.push(Buffer.from('0000000000 65535 f \\n'))
    for (const pos of objPositions) {
      parts.push(Buffer.from(\`\${String(pos).padStart(10, '0')} 00000 n \\n\`))
    }

    // Trailer
    parts.push(Buffer.from(
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

function buildFontDict(): string {
  return \`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\`
}
function buildInfoDict(title?: string, author?: string): string {
  let s = '<< '
  if (title) s += \`/Title (\${escapePdf(title)}) \`
  if (author) s += \`/Author (\${escapePdf(author)}) \`
  s += '/Producer (pdfgen.ts) >>'
  return s
}

interface ImageData { xobj: string; width: number; height: number }

function buildPageStream(
  elements: PDFElement[],
  pageW: number,
  pageH: number,
  margins: { top: number; right: number; bottom: number; left: number },
  contentW: number
): { stream: string; images: ImageData[] } {
  const lines: string[] = []
  let y = pageH - margins.top
  const maxY = margins.bottom + 30
  const images: ImageData[] = []

  const checkPage = () => { /* single page for now */ }

  for (const el of elements) {
    switch (el.type) {
      case 'heading': {
        const size = FONT_SIZES[el.level] || 12
        const font = el.level === 1 ? 'Helvetica-Bold' : el.level === 2 ? 'Helvetica-Bold' : 'Helvetica-Bold'
        const wrapped = wrapText(toWinAnsi(el.text), contentW, size, font)
        const lh = size * LINE_HEIGHT
        y -= lh // spacing before
        for (const line of wrapped) {
          if (y < maxY) break
          lines.push(\`BT /F1 \${size} Tf \${margins.left} \${y} Td (\${escapePdf(line)}) Tj ET\`)
          y -= lh
        }
        y -= 4 // spacing after
        break
      }
      case 'paragraph': {
        const size = 10
        const align = el.align || 'left'
        const wrapped = wrapText(toWinAnsi(el.text), contentW, size)
        const lh = size * LINE_HEIGHT
        for (const line of wrapped) {
          if (y < maxY) break
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
        y -= 2
        for (const item of el.items) {
          const wrapped = wrapText(toWinAnsi(item), contentW - 20, size)
          for (let i = 0; i < wrapped.length; i++) {
            if (y < maxY) break
            const prefix = i === 0 ? '\\\\2022  ' : '     '
            lines.push(\`BT /F1 \${size} Tf \${margins.left} \${y.toFixed(1)} Td (\${prefix}\${escapePdf(wrapped[i])}) Tj ET\`)
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
            if (y < maxY) break
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
        const codeLines = toWinAnsi(el.text).split('\\n')
        const boxH = codeLines.length * lh + 12
        y -= 6
        // Draw background rect
        lines.push(\`0.92 0.92 0.92 rg \${margins.left} \${y - boxH + 6} \${contentW} \${boxH} re f\`)
        y -= 6
        lines.push('0 0 0 rg') // text color
        for (const line of codeLines) {
          if (y < maxY) break
          const escaped = line.replace(/\\\\/g, '\\\\\\\\').replace(/\\(/g, '\\\\(').replace(/\\)/g, '\\\\)')
          lines.push(\`BT /F5 \${size} Tf \${margins.left + 6} \${y.toFixed(1)} Td (\${escaped}) Tj ET\`)
          y -= lh
        }
        y -= 6
        lines.push('0 0 0 rg') // reset
        break
      }
      case 'hr': {
        y -= 8
        const lineY = y + 2
        lines.push(\`0.8 0.8 0.8 RG 0.5 w \${margins.left} \${lineY} \${contentW} 0 re S\`)
        y -= 8
        break
      }
      case 'spacer': {
        y -= el.height || 12
        break
      }
      case 'table': {
        const size = 9
        const lh = size * LINE_HEIGHT
        const cols = el.headers.length
        const colW = el.colWidths || el.headers.map(() => contentW / cols)
        const rowH = lh + 6

        y -= rowH
        // Header background
        lines.push(\`0.15 0.15 0.15 rg \${margins.left} \${y} \${contentW} \${rowH} re f\`)
        lines.push('1 1 1 rg')
        let x = margins.left
        for (let c = 0; c < cols; c++) {
          lines.push(\`BT /F2 \${size} Tf \${x + 4} \${y + 4} Td (\${escapePdf(el.headers[c])}) Tj ET\`)
          x += colW[c]
        }
        lines.push('0 0 0 rg')

        for (const row of el.rows) {
          y -= rowH
          // Alternating row bg
          const rowIdx = el.rows.indexOf(row)
          if (rowIdx % 2 === 0) {
            lines.push(\`0.96 0.96 0.96 rg \${margins.left} \${y} \${contentW} \${rowH} re f\`)
          }
          // Grid lines
          lines.push(\`0.85 0.85 0.85 RG 0.3 w \${margins.left} \${y} \${contentW} 0 re S\`)
          lines.push('0 0 0 rg')
          x = margins.left
          for (let c = 0; c < cols; c++) {
            const cellText = (row[c] || '').substring(0, 50)
            lines.push(\`BT /F1 \${size} Tf \${x + 4} \${y + 4} Td (\${escapePdf(cellText)}) Tj ET\`)
            x += colW[c]
          }
        }
        // Bottom border
        y -= 2
        lines.push(\`0.6 0.6 0.6 RG 0.5 w \${margins.left} \${y + 2} \${contentW} 0 re S\`)
        y -= 6
        break
      }
      case 'image': {
        try {
          const data = readFileSync(el.path)
          // Simple PPM P6 detection — most minimal image support
          if (data[0] === 0x50 && data[1] === 0x36) {
            // PPM format
            y -= (el.height || 100)
            lines.push(\`\${margins.left} \${y} \${el.width || 200} \${el.height || 100} re W n\`)
          } else {
            y -= 20
            // Skip unsupported formats — leave a placeholder text
            lines.push(\`BT /F3 9 Tf \${margins.left} \${y.toFixed(1)} Td (Image: \${basename(el.path)}) Tj ET\`)
          }
        } catch {
          y -= 20
          lines.push(\`BT /F3 9 Tf \${margins.left} \${y.toFixed(1)} Td ([Image not found: \${basename(el.path)}]) Tj ET\`)
        }
        y -= 6
        break
      }
    }
  }

  const streamContent = lines.join('\\n')
  const streamBuf = Buffer.from(streamContent, 'binary')
  const stream = \`<< /Length \${streamBuf.length} >>\\nstream\\n\${streamContent}\\nendstream\`

  return { stream, images }
}

// ─── Public API ───

export async function createPDF(opts: PDFCreateOptions): Promise<Buffer> {
  const writer = new PDFWriter()
  return writer.build(opts)
}


// ─── CLI ───

const args = process.argv.slice(2)
if (args.length > 0) {
  // Simple CLI: bun pdfgen.ts <output.pdf>
  // Reads a JSON spec from stdin or a file
  const outFile = args.find(a => !a.startsWith('--'))
  if (outFile) {
    let spec: PDFCreateOptions
    if (args.includes('--spec')) {
      const specFile = args[args.indexOf('--spec') + 1]
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
