// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { execSync_DEPRECATED } from '../../utils/execSyncWrapper.js'
import { DESCRIPTION } from './prompt.js'

const PHONE_IP = '192.168.1.251'
const DEFAULT_PORT = '40835'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['devices', 'screenshot', 'screenshot_pull', 'tap', 'swipe', 'type', 'launch', 'battery', 'shell'])
      .describe('The Android action to perform'),
    x: z.number().optional().describe('X coordinate for tap'),
    y: z.number().optional().describe('Y coordinate for tap'),
    text: z.string().optional().describe('Text to type'),
    direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Swipe direction'),
    package: z.string().optional().describe('App package name to launch'),
    command: z.string().optional().describe('Shell command to run'),
    duration: z.number().optional().describe('Swipe duration in ms'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    output: z.string().optional(),
    image_base64: z.string().optional(),
    image_path: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function getPhoneDevice(): string {
  try {
    const out = execSync_DEPRECATED('adb devices -l', { encoding: 'utf8', timeout: 5000 })
    const match = out.match(/192\.168\.1\.251:(\d+)/)
    if (match) return `192.168.1.251:${match[1]}`
  } catch {}
  return `${PHONE_IP}:${DEFAULT_PORT}`
}

export const AndroidTool = buildTool({
  name: 'android',
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return true },
  isReadOnly(input) { return !['shell', 'tap', 'swipe', 'type', 'launch'].includes(input.action) },
  async call(input, context, canUseTool, parentMessage) {
    const device = getPhoneDevice()
    const { action, x, y, text, direction, package: pkg, command, duration } = input

    const adb = (args: string[]) =>
      execSync_DEPRECATED(['adb', '-s', device, ...args].join(' '), { encoding: 'utf8', timeout: 20000 })

    try {
      switch (action) {
        case 'devices': {
          const out = execSync_DEPRECATED('adb devices -l', { encoding: 'utf8', timeout: 5000 })
          return { data: { success: true, action: 'devices', output: out } }
        }
        case 'screenshot': {
          execSync_DEPRECATED(`adb -s ${device} shell screencap /sdcard/scr.png`, { encoding: 'utf8', timeout: 10000 })
          const out = execSync_DEPRECATED(`adb -s ${device} shell "cat /sdcard/scr.png | base64"`, { encoding: 'utf8', timeout: 10000 })
          return { data: { success: true, action: 'screenshot', image_base64: out.trim() } }
        }
        case 'screenshot_pull': {
          execSync_DEPRECATED(`adb -s ${device} shell screencap /sdcard/scr.png`, { encoding: 'utf8', timeout: 10000 })
          execSync_DEPRECATED(`adb -s ${device} pull /sdcard/scr.png /tmp/android_screenshot.png`, { encoding: 'utf8', timeout: 10000 })
          return { data: { success: true, action: 'screenshot_pull', image_path: '/tmp/android_screenshot.png' } }
        }
        case 'tap': {
          if (x === undefined || y === undefined) return { data: { success: false, action: 'tap', error: 'x and y required' } }
          const out = adb(['shell', `input tap ${x} ${y}`])
          return { data: { success: true, action: 'tap', output: out } }
        }
        case 'swipe': {
          if (!direction) return { data: { success: false, action: 'swipe', error: 'direction required' } }
          const d = duration ?? 300
          const paths: Record<string, string[]> = {
            up:    ['shell', `input swipe 540 1800 540 200 ${d}`],
            down:  ['shell', `input swipe 540 200 540 1800 ${d}`],
            left:  ['shell', `input swipe 1000 1000 100 1000 ${d}`],
            right: ['shell', `input swipe 100 1000 1000 1000 ${d}`],
          }
          const out = adb(paths[direction])
          return { data: { success: true, action: 'swipe', output: out } }
        }
        case 'type': {
          if (!text) return { data: { success: false, action: 'type', error: 'text required' } }
          const escaped = text.replace(/'/g, "'\\''")
          const out = adb(['shell', `input text '${escaped}'`])
          return { data: { success: true, action: 'type', output: out } }
        }
        case 'launch': {
          if (!pkg) return { data: { success: false, action: 'launch', error: 'package required' } }
          const out = adb(['shell', `am start -n ${pkg}/.MainActivity`])
          return { data: { success: true, action: 'launch', output: out } }
        }
        case 'battery': {
          const out = adb(['shell', 'dumpsys battery'])
          return { data: { success: true, action: 'battery', output: out } }
        }
        case 'shell': {
          if (!command) return { data: { success: false, action: 'shell', error: 'command required' } }
          const out = adb(['shell', command])
          return { data: { success: true, action: 'shell', output: out } }
        }
        default:
          return { data: { success: false, action, error: `Unknown action: ${action}` } }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: { success: false, action, error: msg } }
    }
  },

  mapToolResultToToolResultBlockParam(data: z.infer<OutputSchema>, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, Output>)
