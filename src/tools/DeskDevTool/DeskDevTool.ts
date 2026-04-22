// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { execSync_DEPRECATED } from '../../utils/execSyncWrapper.js'
import { DESCRIPTION } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['screenshot', 'click', 'type', 'open', 'windows', 'front']).describe('Desktop dev action'),
    x: z.number().optional().describe('X coordinate for click'),
    y: z.number().optional().describe('Y coordinate for click'),
    text: z.string().optional().describe('Text to type'),
    app: z.string().optional().describe('App name/bundle to open'),
    windowId: z.string().optional().describe('Window ID'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    output: z.string().optional(),
    image_base64: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function macOS() { return process.platform === 'darwin' }

export const DeskDevTool = buildTool({
  name: 'desktop_dev',
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return false },
  isReadOnly(input) { return ['screenshot', 'windows'].includes(input.action) },
  async call(input, context, canUseTool, parentMessage) {
    const { action, x, y, text, app } = input
    if (!macOS()) return { data: { success: false, action, error: 'Desktop dev tools currently only support macOS' } }

    try {
      switch (action) {
        case 'screenshot': {
          execSync_DEPRECATED('screencapture /tmp/desk_screenshot.png', { encoding: 'utf8', timeout: 5000 })
          const b64 = execSync_DEPRECATED('base64 < /tmp/desk_screenshot.png', { encoding: 'utf8' })
          return { data: { success: true, action: 'screenshot', image_base64: b64.trim() } }
        }
        case 'click': {
          if (x === undefined || y === undefined) return { data: { success: false, action: 'click', error: 'x and y required' } }
          execSync_DEPRECATED(`osascript -e 'tell application "System Events" to click at {${x}, ${y}}'`, { encoding: 'utf8', timeout: 5000 })
          return { data: { success: true, action: 'click' } }
        }
        case 'type': {
          if (!text) return { data: { success: false, action: 'type', error: 'text required' } }
          const escaped = text.replace(/"/g, '\\"')
          execSync_DEPRECATED(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`, { encoding: 'utf8', timeout: 5000 })
          return { data: { success: true, action: 'type' } }
        }
        case 'open': {
          if (!app) return { data: { success: false, action: 'open', error: 'app name required' } }
          execSync_DEPRECATED(`open -a "${app}"`, { encoding: 'utf8', timeout: 10000 })
          return { data: { success: true, action: 'open' } }
        }
        case 'windows': {
          const out = execSync_DEPRECATED("osascript -e 'tell application \"System Events\" to get name of every window'", { encoding: 'utf8', timeout: 5000 })
          return { data: { success: true, action: 'windows', output: out } }
        }
        case 'front': {
          if (!app) return { data: { success: false, action: 'front', error: 'app name required' } }
          execSync_DEPRECATED(`osascript -e 'tell application "${app}" to activate'`, { encoding: 'utf8', timeout: 5000 })
          return { data: { success: true, action: 'front' } }
        }
        default:
          return { data: { success: false, action, error: `Unknown action: ${action}` } }
      }
    } catch (err: unknown) {
      return { data: { success: false, action, error: err instanceof Error ? err.message : String(err) } }
    }
  },

  mapToolResultToToolResultBlockParam(data: z.infer<OutputSchema>, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, Output>)
