// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['status', 'ai', 'shell', 'toggle']).describe('Mode swap action'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    mode: z.string(),
    hint: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

// In-memory mode state for this session
let currentMode: 'ai' | 'shell' = 'ai'

export const SwapTool = buildTool({
  name: 'swap',
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  async call(input, context, canUseTool, parentMessage) {
    const { action } = input

    switch (action) {
      case 'status':
        return {
          data: {
            success: true,
            action: 'status',
            mode: currentMode,
            hint:
              currentMode === 'ai'
                ? 'Currently in AI mode. Use /swap shell to switch to direct shell execution.'
                : 'Currently in SHELL mode. Type commands directly. Use /swap ai to return to AI mode.',
          },
        }

      case 'ai':
        currentMode = 'ai'
        return {
          data: {
            success: true,
            action: 'ai',
            mode: 'ai',
            hint: 'Switched to AI mode. Type prompts for full AI assistance.',
          },
        }

      case 'shell':
        currentMode = 'shell'
        return {
          data: {
            success: true,
            action: 'shell',
            mode: 'shell',
            hint: 'Switched to SHELL mode. Type commands directly for execution without AI processing. Use /swap ai to return to AI mode.',
          },
        }

      case 'toggle':
        currentMode = currentMode === 'ai' ? 'shell' : 'ai'
        return {
          data: {
            success: true,
            action: 'toggle',
            mode: currentMode,
            hint:
              currentMode === 'ai'
                ? 'Toggled to AI mode. Press Ctrl-X or use /swap shell to switch back.'
                : 'Toggled to SHELL mode. Type commands directly. Press Ctrl-X or use /swap ai to return to AI mode.',
          },
        }

      default:
        return {
          data: {
            success: false,
            action,
            mode: currentMode,
            error: `Unknown action: ${action}`,
          },
        }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
