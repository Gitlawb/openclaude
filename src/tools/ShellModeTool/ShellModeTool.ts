// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['status', 'switch', 'help']).describe('Shell mode action'),
    mode: z.enum(['ai', 'shell']).optional().describe('Mode to switch to'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    mode: z.string().optional(),
    hint: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const ShellModeTool = buildTool({
  name: 'shell_mode',
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  async call(input, context, canUseTool, parentMessage) {
    const { action, mode } = input

    switch (action) {
      case 'status':
        return { data: { success: true, action: 'status', mode: 'ai', hint: 'Press Ctrl-X to toggle between AI mode and direct shell execution' } }
      case 'switch':
        return { data: { success: true, action: 'switch', mode: mode ?? 'ai', hint: mode === 'shell' ? 'Switched to SHELL mode. Type commands directly. Press Ctrl-X to return to AI mode.' : 'Switched to AI mode. Type prompts for AI assistance.' } }
      case 'help':
        return { data: { success: true, action: 'help', hint: 'Shell Mode (Kimi CLI style): Press Ctrl-X to toggle AI/shell. In shell mode type commands directly. Built-in commands like cd not supported. Integrates with Zed, JetBrains via ACP.' } }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },

  mapToolResultToToolResultBlockParam(data: z.infer<OutputSchema>, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, Output>)
