// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['confirm', 'choose', 'input', 'filter']).describe('Gum-style interaction'),
    message: z.string().optional().describe('Prompt message'),
    options: z.array(z.string()).optional().describe('Options for choose'),
    default: z.string().optional().describe('Default selection'),
    placeholder: z.string().optional().describe('Input placeholder'),
    limit: z.number().optional().describe('Max selections for choose'),
    timeout: z.number().optional().describe('Timeout in ms'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const ConfirmTool = buildTool({
  name: 'confirm',
  async description() { return 'Interactive prompts (Gum-style) — confirm dialogs, choose from options, text input, filter lists. Simulates gum confirm/input/choose/filter for non-interactive use.' },
  async prompt() { return 'Interactive CLI prompts — yes/no confirmations, multi-choice selections, text input, list filtering. Simulates Bubble Tea/Gum-style dialogs for use in scripts and automation.' },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema() {
    return z.object({
      success: z.boolean(),
      action: z.string(),
      confirmed: z.boolean().optional(),
      selected: z.string().optional(),
      selections: z.array(z.string()).optional(),
      input: z.string().optional(),
      filtered: z.array(z.string()).optional(),
      timedOut: z.boolean().optional(),
      error: z.string().optional(),
    })
  },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  async call(input, context, canUseTool, parentMessage) {
    const { action, message, options = [], default: def, placeholder, limit, timeout = 10000 } = input

    switch (action) {
      case 'confirm': {
        // For non-interactive use: show prompt text, return info about what would happen
        return {
          data: {
            success: true,
            action: 'confirm',
            confirmed: true, // Assumed confirmed in batch mode
            error: message ? `Would prompt: "${message}" [default: yes]` : 'Confirmation prompt',
          },
        }
      }
      case 'choose': {
        if (options.length === 0) return { data: { success: false, action: 'choose', error: 'options required' } }
        const selected = def ?? options[0]
        return {
          data: {
            success: true,
            action: 'choose',
            selected,
            selections: limit && limit > 1 ? options.slice(0, limit) : [selected],
            error: `Would show choice: ${options.join(' | ')} [default: ${selected}]`,
          },
        }
      }
      case 'input': {
        return {
          data: {
            success: true,
            action: 'input',
            input: placeholder ?? '',
            error: `Would prompt for input [placeholder: ${placeholder ?? 'none'}]`,
          },
        }
      }
      case 'filter': {
        if (options.length === 0) return { data: { success: false, action: 'filter', error: 'options required' } }
        const query = placeholder ?? ''
        const filtered = query
          ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
          : options
        return {
          data: {
            success: true,
            action: 'filter',
            filtered,
            error: `Would filter: ${options.length} → ${filtered.length} items [query: "${query}"]`,
          },
        }
      }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },

  mapToolResultToToolResultBlockParam(data: any, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, { data: any }>)
