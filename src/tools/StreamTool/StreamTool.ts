// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['thinking', 'searching', 'building', 'council', 'spinner', 'progress', 'done']).describe('Stream action'),
    message: z.string().optional().describe('Message to display'),
    step: z.number().optional().describe('Current step number'),
    total: z.number().optional().describe('Total steps'),
    token: z.string().optional().describe('Activity token/org name'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const COUNCIL_FRAMES = ['🌐', '⚖️', '🔄', '⚡', '🎯']
const SEARCH_ICONS = ['🔍', '🌐', '📡', '🔎']

function spin(frame: number) { return SPINNER_FRAMES[frame % SPINNER_FRAMES.length] }
function thinking_dot(n: number) { return '●'.repeat(n % 4) + '○'.repeat(3 - (n % 4)) }
function progressBar(pct: number, width = 30) {
  const filled = Math.round(pct * width / 100)
  const empty = width - filled
  return '█'.repeat(filled) + '░'.repeat(empty)
}

export const StreamTool = buildTool({
  name: 'stream',
  async description() { return 'Progressive output streaming — animated spinners, thinking dots, progress bars, council indicators. Gum-style loading states for long operations.' },
  async prompt() { return 'Animated progressive output — spinners, thinking indicators, progress bars for /search, /build, /council commands. Makes long operations feel alive.' },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema() {
    return z.object({
      success: z.boolean(),
      action: z.string(),
      frame: z.string().optional(),
      output: z.string().optional(),
      error: z.string().optional(),
    })
  },
  isConcurrencySafe() { return false },
  isReadOnly() { return true },
  async call(input, context, canUseTool, parentMessage) {
    const { action, message, step = 1, total = 1, token } = input
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const frame = step % 10

    switch (action) {
      case 'spinner':
        return { data: { success: true, action: 'spinner', frame: spin(frame), output: `\r${spin(frame)} ${message ?? 'working…'}` } }
      case 'thinking':
        return { data: { success: true, action: 'thinking', frame: thinking_dot(step), output: `\r🤔 ${message ?? 'thinking'} ${thinking_dot(step)}` } }
      case 'searching': {
        const icon = SEARCH_ICONS[(step - 1) % SEARCH_ICONS.length]
        return { data: { success: true, action: 'searching', frame: icon, output: `\r${icon} ${message ?? 'searching…'}` } }
      }
      case 'building':
        return { data: { success: true, action: 'building', frame: spin(frame), output: `\r${spin(frame)} 🔧 ${message ?? 'building…'}` } }
      case 'council': {
        const icon = COUNCIL_FRAMES[(step - 1) % COUNCIL_FRAMES.length]
        return { data: { success: true, action: 'council', frame: icon, output: `\r${icon} 🏛️ ${message ?? 'council deliberating…'}` } }
      }
      case 'progress': {
        const pct = Math.round((step / total) * 100)
        const bar = progressBar(pct)
        return { data: { success: true, action: 'progress', frame: spin(frame), output: `\r${spin(frame)} ${bar} ${pct}% — ${message ?? `step ${step}/${total}`}` } }
      }
      case 'done':
        return { data: { success: true, action: 'done', frame: '✅', output: `✅ ${message ?? 'done'} (${now})` } }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },

  mapToolResultToToolResultBlockParam(data: any, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, { data: any }>)
