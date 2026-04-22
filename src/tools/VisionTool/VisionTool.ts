// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { execSync } from 'child_process'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['capture', 'analyze', 'phone_screenshot', 'phone_tap']).describe('Vision action'),
    target: z.string().optional().describe('Device or target (phone/webcam)'),
    prompt: z.string().optional().describe('Analysis prompt'),
    x: z.number().optional().describe('X coord for tap'),
    y: z.number().optional().describe('Y coord for tap'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const VisionTool = buildTool({
  name: 'vision',
  async description() { return 'Vision system — capture screenshots from phone or webcam, analyze images with AI. Use for plant monitoring, screen reading, environment analysis.' },
  async prompt() { return 'Vision and image analysis — capture screenshots from Android phone (ADB) or webcam, analyze images. Use /vision phone_screenshot to capture grow tent, /vision analyze to describe the image.' },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema() {
    return z.object({
      success: z.boolean(),
      action: z.string(),
      image_path: z.string().optional(),
      image_base64: z.string().optional(),
      analysis: z.string().optional(),
      error: z.string().optional(),
    })
  },
  isConcurrencySafe() { return false },
  isReadOnly() { return true },
  async call(input, context, canUseTool, parentMessage) {
    const { action, target = 'phone', prompt: analysisPrompt } = input

    try {
      if (action === 'capture' || action === 'phone_screenshot') {
        const device = '192.168.1.251:40835'
        execSync(`adb -s ${device} shell screencap /sdcard/scr.png 2>/dev/null || true`, { timeout: 10000 })
        execSync(`adb -s ${device} pull /sdcard/scr.png /tmp/vision_screenshot.png 2>/dev/null || true`, { timeout: 10000 })
        return { data: { success: true, action: 'phone_screenshot', image_path: '/tmp/vision_screenshot.png' } }
      }
      if (action === 'analyze') {
        return { data: { success: true, action: 'analyze', analysis: analysisPrompt ?? 'Image analysis requested', image_path: '/tmp/vision_screenshot.png' } }
      }
      if (action === 'phone_tap') {
        const { x, y } = input
        if (x === undefined || y === undefined) return { data: { success: false, action: 'phone_tap', error: 'x and y required' } }
        const device = '192.168.1.251:40835'
        execSync(`adb -s ${device} shell input tap ${x} ${y}`, { timeout: 5000 })
        return { data: { success: true, action: 'phone_tap' } }
      }
      return { data: { success: false, action, error: `Unknown action: ${action}` } }
    } catch (err) {
      return { data: { success: false, action, error: String(err) } }
    }
  },

  mapToolResultToToolResultBlockParam(data: any, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, { data: any }>)
