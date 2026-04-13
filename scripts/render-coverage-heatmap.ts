import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'

type FileCoverage = {
  path: string
  found: number
  hit: number
  chunks: number[]
}

type DirectoryCoverage = {
  path: string
  found: number
  hit: number
}

const LCOV_PATH = resolve(process.cwd(), 'coverage/lcov.info')
const HTML_PATH = resolve(process.cwd(), 'coverage/index.html')
const CHUNK_COUNT = 20

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function bucketColor(ratio: number): string {
  if (ratio >= 0.9) return '#166534'
  if (ratio >= 0.75) return '#15803d'
  if (ratio >= 0.5) return '#65a30d'
  if (ratio > 0) return '#a3a3a3'
  return '#262626'
}

function coverageLabel(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

function coverageRatio(found: number, hit: number): number {
  return found === 0 ? 0 : hit / found
}

function bucketGlyph(ratio: number): string {
  if (ratio >= 0.9) return '█'
  if (ratio >= 0.75) return '▓'
  if (ratio >= 0.5) return '▒'
  if (ratio > 0) return '░'
  return '·'
}

function terminalBar(chunks: number[]): string {
  return chunks.map(bucketGlyph).join('')
}

function summarizeDirectories(files: FileCoverage[]): DirectoryCoverage[] {
  const dirs = new Map<string, DirectoryCoverage>()

  for (const file of files) {
    const dir =
      file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.'
    const current = dirs.get(dir) ?? { path: dir, found: 0, hit: 0 }
    current.found += file.found
    current.hit += file.hit
    dirs.set(dir, current)
  }

  return [...dirs.values()].sort((a, b) => {
    const left = coverageRatio(a.found, a.hit)
    const right = coverageRatio(b.found, b.hit)
    if (right !== left) return right - left
    return b.found - a.found
  })
}

function buildTerminalReport(files: FileCoverage[]): string {
  const totalFound = files.reduce((sum, file) => sum + file.found, 0)
  const totalHit = files.reduce((sum, file) => sum + file.hit, 0)
  const totalRatio = coverageRatio(totalFound, totalHit)
  const overallChunks = new Array(CHUNK_COUNT).fill(totalRatio)
  const topDirectories = summarizeDirectories(files)
    .filter(dir => dir.found > 0)
    .slice(0, 8)
  const lowestFiles = [...files]
    .filter(file => file.found >= 20)
    .sort((a, b) => {
      const left = coverageRatio(a.found, a.hit)
      const right = coverageRatio(b.found, b.hit)
      if (left !== right) return left - right
      return b.found - a.found
    })
    .slice(0, 10)

  const lines = [
    '',
    'Coverage Activity',
    `${terminalBar(overallChunks)}  ${coverageLabel(totalRatio)}  ${totalHit}/${totalFound} lines  ${files.length} files`,
    '',
    'Top Directories',
  ]

  for (const dir of topDirectories) {
    const ratio = coverageRatio(dir.found, dir.hit)
    lines.push(
      `${terminalBar(new Array(12).fill(ratio))}  ${coverageLabel(ratio).padStart(4)}  ${String(dir.hit).padStart(5)}/${String(dir.found).padEnd(5)}  ${dir.path}`,
    )
  }

  lines.push('', 'Lowest Coverage Files')

  for (const file of lowestFiles) {
    const ratio = coverageRatio(file.found, file.hit)
    lines.push(
      `${terminalBar(file.chunks).padEnd(CHUNK_COUNT)}  ${coverageLabel(ratio).padStart(4)}  ${String(file.hit).padStart(5)}/${String(file.found).padEnd(5)}  ${file.path}`,
    )
  }

  lines.push('', `HTML report: ${HTML_PATH}`)
  return lines.join('\n')
}

function parseLcov(content: string): FileCoverage[] {
  const files: FileCoverage[] = []
  const sections = content.split('end_of_record')

  for (const rawSection of sections) {
    const section = rawSection.trim()
    if (!section) continue

    const lines = section.split('\n')
    let filePath = ''
    const lineHits = new Map<number, number>()

    for (const line of lines) {
      if (line.startsWith('SF:')) {
        filePath = line.slice(3).trim()
      } else if (line.startsWith('DA:')) {
        const [lineNumberText, hitText] = line.slice(3).split(',')
        const lineNumber = Number(lineNumberText)
        const hits = Number(hitText)
        if (Number.isFinite(lineNumber) && Number.isFinite(hits)) {
          lineHits.set(lineNumber, hits)
        }
      }
    }

    if (!filePath || lineHits.size === 0) continue

    const ordered = [...lineHits.entries()].sort((a, b) => a[0] - b[0])
    const found = ordered.length
    const hit = ordered.filter(([, hits]) => hits > 0).length
    const chunkSize = Math.max(1, Math.ceil(found / CHUNK_COUNT))
    const chunks: number[] = []

    for (let index = 0; index < found; index += chunkSize) {
      const slice = ordered.slice(index, index + chunkSize)
      const covered = slice.filter(([, hits]) => hits > 0).length
      chunks.push(slice.length === 0 ? 0 : covered / slice.length)
    }

    while (chunks.length < CHUNK_COUNT) {
      chunks.push(0)
    }

    files.push({
      path: filePath,
      found,
      hit,
      chunks: chunks.slice(0, CHUNK_COUNT),
    })
  }

  return files.sort((a, b) => {
    const left = a.found === 0 ? 0 : a.hit / a.found
    const right = b.found === 0 ? 0 : b.hit / b.found
    if (right !== left) return right - left
    return a.path.localeCompare(b.path)
  })
}

function buildHtml(files: FileCoverage[]): string {
  const totalFound = files.reduce((sum, file) => sum + file.found, 0)
  const totalHit = files.reduce((sum, file) => sum + file.hit, 0)
  const totalRatio = totalFound === 0 ? 0 : totalHit / totalFound

  const cards = [
    ['Files', String(files.length)],
    ['Covered Lines', `${totalHit}/${totalFound}`],
    ['Line Coverage', coverageLabel(totalRatio)],
  ]

  const rows = files
    .map(file => {
      const ratio = file.found === 0 ? 0 : file.hit / file.found
      const squares = file.chunks
        .map(
          (chunk, index) =>
            `<span class="cell" title="Chunk ${index + 1}: ${coverageLabel(chunk)}" style="background:${bucketColor(chunk)}"></span>`,
        )
        .join('')

      return `
        <tr>
          <td class="file">${escapeHtml(file.path)}</td>
          <td class="percent">${coverageLabel(ratio)}</td>
          <td class="lines">${file.hit}/${file.found}</td>
          <td class="heatmap">${squares}</td>
        </tr>
      `
    })
    .join('')

  const summary = cards
    .map(
      ([label, value]) => `
        <div class="card">
          <div class="card-label">${escapeHtml(label)}</div>
          <div class="card-value">${escapeHtml(value)}</div>
        </div>
      `,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenClaude Coverage</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #09090b;
        --panel: #111113;
        --panel-2: #18181b;
        --border: #27272a;
        --text: #fafafa;
        --muted: #a1a1aa;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: linear-gradient(180deg, #09090b 0%, #0f0f12 100%);
        color: var(--text);
        font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      main {
        max-width: 1440px;
        margin: 0 auto;
        padding: 32px 24px 48px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 32px;
        letter-spacing: -0.04em;
      }
      p {
        margin: 0;
        color: var(--muted);
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin: 24px 0;
      }
      .card {
        background: rgba(24, 24, 27, 0.92);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 16px 18px;
      }
      .card-label {
        color: var(--muted);
        margin-bottom: 8px;
      }
      .card-value {
        font-size: 28px;
        font-weight: 700;
      }
      .table-wrap {
        background: rgba(17, 17, 19, 0.94);
        border: 1px solid var(--border);
        border-radius: 18px;
        overflow: hidden;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      thead th {
        text-align: left;
        color: var(--muted);
        font-weight: 500;
        background: rgba(24, 24, 27, 0.95);
        border-bottom: 1px solid var(--border);
      }
      th, td {
        padding: 12px 16px;
        vertical-align: middle;
      }
      tbody tr + tr td {
        border-top: 1px solid rgba(39, 39, 42, 0.65);
      }
      .file {
        width: 48%;
        word-break: break-all;
      }
      .percent, .lines {
        white-space: nowrap;
      }
      .heatmap {
        width: 32%;
        min-width: 280px;
      }
      .cell {
        display: inline-block;
        width: 12px;
        height: 12px;
        margin-right: 4px;
        border-radius: 3px;
        border: 1px solid rgba(255,255,255,0.05);
      }
      .legend {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 16px;
        color: var(--muted);
      }
      .legend-scale {
        display: flex;
        gap: 4px;
      }
      @media (max-width: 900px) {
        .summary {
          grid-template-columns: 1fr;
        }
        .heatmap {
          min-width: 220px;
        }
        th, td {
          padding: 10px 12px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Coverage Activity</h1>
      <p>Git-style heatmap generated from coverage/lcov.info</p>
      <section class="summary">${summary}</section>
      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Coverage</th>
              <th>Lines</th>
              <th>Activity</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
      <div class="legend">
        <span>Less</span>
        <div class="legend-scale">
          <span class="cell" style="background:#262626"></span>
          <span class="cell" style="background:#a3a3a3"></span>
          <span class="cell" style="background:#65a30d"></span>
          <span class="cell" style="background:#15803d"></span>
          <span class="cell" style="background:#166534"></span>
        </div>
        <span>More</span>
      </div>
    </main>
  </body>
</html>`
}

async function main() {
  const content = await readFile(LCOV_PATH, 'utf8')
  const files = parseLcov(content)
  const html = buildHtml(files)
  await mkdir(dirname(HTML_PATH), { recursive: true })
  await writeFile(HTML_PATH, html, 'utf8')
  console.log(buildTerminalReport(files))
  console.log(`coverage heatmap written to ${HTML_PATH}`)
}

await main()
