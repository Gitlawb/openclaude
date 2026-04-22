// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['render', 'clear', 'model', 'tokens', 'session', 'mode']).describe('Status bar action'),
    model: z.string().optional().describe('Model name to display'),
    tokens: z.number().optional().describe('Token count'),
    mode: z.enum(['chat', 'shell', 'plan', 'agent']).optional().describe('Current mode'),
    message: z.string().optional().describe('Custom message'),
    stream: z.boolean().optional().describe('Show streaming indicator'),
    cost: z.number().optional().describe('Session cost in USD'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

// Simple ANSI color codes (Lip Gloss equivalent)
const styles = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  italic: (s: string) => `\x1b[3m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  white: (s: string) => `\x1b[37m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bgBlue: (s: string) => `\x1b[44m${s}\x1b[0m`,
  bgGreen: (s: string) => `\x1b[42m${s}\x1b[0m`,
  bgRed: (s: string) => `\x1b[41m${s}\x1b[0m`,
}

function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s }

function renderBar(items: Array<{label: string; value: string; color: string}>, width = 80) {
  const parts: string[] = []
  for (const item of items) {
    parts.push(` ${styles.bold(item.color(`[${item.label}]`))} ${item.value} `)
  }
  const line = parts.join('')
  if (line.length > width) {
    // Truncate from the right
    return line.slice(0, width - 1) + '…'
  }
  return line
}

export const StatusBarTool = buildTool({
  name: 'statusbar',
  async description() { return 'Bubble Tea style status bar — renders colored session info (model, tokens, mode, cost) in REPL footer. Lip Gloss inspired ANSI styling.' },
  async prompt() { return 'Bubble Tea style status bar for REPL — shows model name, token count, mode indicator, session cost. Use /statusbar render to display the current status bar.' },
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
    const { action, model, tokens, mode, message, stream, cost } = input

    switch (action) {
      case 'render': {
        const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        const items = [
          { label: now, value: 'DuckHive', color: styles.cyan },
        ]
        if (model) items.push({ label: 'model', value: truncate(model, 20), color: styles.green })
        if (tokens !== undefined) items.push({ label: 'tokens', value: tokens.toLocaleString(), color: styles.blue })
        if (mode) items.push({ label: 'mode', value: mode.toUpperCase(), color: styles.yellow })
        if (stream) items.push({ label: 'status', value: 'streaming', color: styles.magenta })
        if (cost !== undefined) items.push({ label: 'cost', value: `$${cost.toFixed(4)}`, color: styles.gray })
        if (message) items.push({ label: 'msg', value: truncate(message, 30), color: styles.white })

        const bar = renderBar(items)
        const separator = styles.dim('─'.repeat(Math.min(bar.length, 80)))
        return {
          data: {
            success: true,
            action: 'render',
            output: `\n${separator}\n${bar}\n${separator}`,
          },
        }
      }
      case 'model':
        return { data: { success: true, action: 'model', output: model ? styles.green(`● ${model}`) : styles.red('○ no model') } }
      case 'tokens':
        return { data: { success: true, action: 'tokens', output: tokens !== undefined ? styles.blue(`${tokens.toLocaleString()} tok`) : '0 tok' } }
      case 'session':
        return { data: { success: true, action: 'session', output: styles.cyan('DuckHive v0.5.2') } }
      case 'mode':
        return { data: { success: true, action: 'mode', output: mode ? styles.yellow(`[${mode.toUpperCase()}]`) : '[CHAT]' } }
      case 'clear':
        return { data: { success: true, action: 'clear', output: '\x1b[2J\x1b[H' } } // ANSI clear screen
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },

  mapToolResultToToolResultBlockParam(data: any, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, { data: any }>)
