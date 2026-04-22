// @ts-nocheck
/**
 * REPLPanelTool — Bubble Tea inspired panel rendering for REPL output
 * Renders structured data (council votes, team status, progress) as
 * bordered panels in the terminal with ANSI styling.
 */
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['panel', 'header', 'footer', 'split', 'table', 'vote_panel']).describe('Panel action'),
    title: z.string().optional().describe('Panel title'),
    content: z.string().optional().describe('Panel body'),
    lines: z.array(z.string()).optional().describe('Table rows'),
    cols: z.array(z.string()).optional().describe('Table headers'),
    votes: z.record(z.string()).optional().describe('Vote counts by option'),
    height: z.number().optional().describe('Panel height'),
    width: z.number().optional().describe('Panel width'),
    color: z.enum(['blue','green','red','yellow','cyan','magenta','white']).optional().describe('Border color'),
    style: z.enum(['rounded','sharp','double','bold']).optional().describe('Border style'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const C = {
  blue: '\x1b[34m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', white: '\x1b[37m', gray: '\x1b[90m',
  bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m',
  bgBlue: '\x1b[44m', bgGreen: '\x1b[42m', bgCyan: '\x1b[46m',
}

type Color = keyof typeof C

const BORDERS: Record<string, {tl:string;tr:string;bl:string;br:string;h:string;v:string}> = {
  rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  sharp:   { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' },
  double:  { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
  bold:    { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
}

function renderBox(title: string, lines: string[], opts: { color?: Color; style?: string; width?: number; height?: number }) {
  const { color = 'cyan', style = 'rounded', width = 60, height } = opts
  const b = BORDERS[style] ?? BORDERS.rounded
  const c = C[color]
  const col = (text: string) => `${c}${text}${C.reset}`
  const bold = (text: string) => `${C.bold}${text}${C.reset}`

  const actualLines = lines.slice(0, height ?? lines.length)
  const topLine = `${col(b.tl)}${b.h.repeat(width - 2)}${col(b.tr)}`
  const bottomLine = `${col(b.bl)}${b.h.repeat(width - 2)}${col(b.br)}`

  let titleLine = ''
  if (title) {
    const titlePad = width - 4 - title.length
    const leftPad = Math.floor(titlePad / 2)
    const rightPad = titlePad - leftPad
    titleLine = `${col(b.v)} ${C.bold}${title}${C.reset}${' '.repeat(leftPad)}${col(b.v)}`
  }

  const contentLines: string[] = title ? [topLine, titleLine] : [topLine]
  for (const line of actualLines) {
    const padded = line.length >= width - 4 ? line.slice(0, width - 5) : line + ' '.repeat(width - 4 - line.length)
    contentLines.push(`${col(b.v)} ${padded} ${col(b.v)}`)
  }
  // Pad with empty lines if height is set
  if (height) {
    while (contentLines.length < height + (title ? 2 : 1)) {
      const empty = ' '.repeat(width - 4)
      contentLines.push(`${col(b.v)} ${empty} ${col(b.v)}`)
    }
  }
  contentLines.push(bottomLine)
  return contentLines.join('\n')
}

function renderTable(cols: string[], rows: string[][], opts: { width?: number; color?: Color }) {
  const { width = 80, color = 'green' } = opts
  const c = C[color]
  const col = (text: string) => `${c}${text}${C.reset}`

  const colWidths = cols.map((h, i) => {
    const maxData = Math.max(...(rows.map(r => (r[i] ?? '').length)), 0)
    return Math.max(h.length, maxData, 5) + 2
  })
  const totalW = colWidths.reduce((a, b) => a + b, 0) + colWidths.length + 1
  const actualW = Math.min(totalW, width)
  const scale = actualW / totalW
  const scaledWidths = colWidths.map(w => Math.max(8, Math.floor(w * scale)))

  const divider = scaledWidths.map(w => C.gray + '─'.repeat(w) + C.reset).join('+')
  const headerCells = cols.map((h, i) => {
    const pad = scaledWidths[i] - h.length - 2
    return ` ${h}${' '.repeat(pad)} `
  })

  const lines: string[] = []
  lines.push(C.bold + cols.map((_, i) => C[color] + '─'.repeat(scaledWidths[i]) + C.reset).join('┬') + C.reset)
  lines.push(`${C.gray}│${C.reset}` + headerCells.map((cell, i) => `${C.bold}${C[color]}${cell}${C.reset}`).join(`${C.gray}│${C.reset}`) + `${C.gray}│${C.reset}`)
  lines.push(C.bold + cols.map((_, i) => C[color] + '─'.repeat(scaledWidths[i]) + C.reset).join('┼') + C.reset)

  for (const row of rows.slice(0, 20)) {
    const cells = row.map((cell, i) => {
      const padded = (cell ?? '').length >= scaledWidths[i] - 2 ? (cell ?? '').slice(0, scaledWidths[i] - 3) + '…' : (cell ?? '') + ' '.repeat(scaledWidths[i] - 2 - (cell ?? '').length)
      return ` ${padded} `
    })
    lines.push(`${C.gray}│${C.reset}` + cells.join(`${C.gray}│${C.reset}`) + `${C.gray}│${C.reset}`)
  }
  return lines.join('\n')
}

export const REPLPanelTool = buildTool({
  name: 'panel',
  async description() { return 'Bubble Tea inspired panel renderer — bordered panels, table views, vote panels for REPL. Render council results, team status, progress as styled terminal output.' },
  async prompt() { return 'Terminal panel rendering — bordered boxes, table views, vote tally panels. Simulates Bubble Tea TUI for structured data display. Use /panel to render structured REPL output.' },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema() {
    return z.object({
      success: z.boolean(),
      action: z.string(),
      output: z.string().optional(),
      error: z.string().optional(),
    })
  },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  async call(input, context, canUseTool, parentMessage) {
    const { action, title, content, lines = [], cols, votes, width, height, color, style } = input

    switch (action) {
      case 'panel': {
        const bodyLines = content ? [content] : lines
        const panel = renderBox(title ?? 'Panel', bodyLines, { color, style, width: width ?? 50, height })
        return { data: { success: true, action: 'panel', output: `\n${panel}` } }
      }
      case 'table': {
        if (!cols) return { data: { success: false, action: 'table', error: 'cols required' } }
        const table = renderTable(cols, lines.map(l => l.split('\t')), { width: width ?? 80, color: color as Color ?? 'green' })
        return { data: { success: true, action: 'table', output: `\n${table}` } }
      }
      case 'vote_panel': {
        if (!votes) return { data: { success: false, action: 'vote_panel', error: 'votes required' } }
        const entries = Object.entries(votes).sort((a, b) => Number(b[1]) - Number(a[1]))
        const maxV = Math.max(...entries.map(e => Number(e[1])), 1)
        const voteLines = entries.map(([k, v]) => {
          const bar = '█'.repeat(Math.round((Number(v) / maxV) * 20))
          const pct = ((Number(v) / Math.max(1, entries.reduce((a, [, cv]) => a + Number(cv), 0))) * 100).toFixed(0)
          return `${k}: ${C.cyan}${bar}${C.reset} ${C.bold}${v}${C.reset} (${pct}%)`
        })
        const panel = renderBox(title ?? 'Vote Tally', voteLines, { color: 'cyan', style: 'bold', width: width ?? 50, height })
        return { data: { success: true, action: 'vote_panel', output: `\n${panel}` } }
      }
      case 'header': {
        const c2 = C[color ?? 'cyan']
        const line = `${C.bold}${c2}${'═'.repeat(width ?? 50)}${C.reset}`
        const text = title ? `${C.bold}${c2}${title}${C.reset}` : ''
        return { data: { success: true, action: 'header', output: `\n${text}\n${line}` } }
      }
      case 'footer':
        return { data: { success: true, action: 'footer', output: `${C.gray}${'─'.repeat(width ?? 50)}${C.reset}\n` } }
      case 'split': {
        const c2 = C[color ?? 'cyan']
        return { data: { success: true, action: 'split', output: `${C.bold}${c2}${'─'.repeat(width ?? 50)}${C.reset}` } }
      }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },

  mapToolResultToToolResultBlockParam(data: any, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, { data: any }>)
