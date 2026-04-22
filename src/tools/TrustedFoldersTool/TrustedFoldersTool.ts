// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { writeFileSync, readFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const CONFIG_FILE = resolve(process.env.HOME ?? '~', '.config/openclaude/trusted-folders.json')

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['list', 'add', 'remove', 'check', 'enable', 'disable']).describe('Trusted folders action'),
    path: z.string().optional().describe('Path to add/check'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    paths: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    allowed: z.boolean().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function loadConfig(): { paths: string[]; enabled: boolean } {
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) } catch { return { paths: [], enabled: false } }
}

function saveConfig(cfg: { paths: string[]; enabled: boolean }) {
  mkdirSync(resolve(CONFIG_FILE, '..'), { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8')
}

export const TrustedFoldersTool = buildTool({
  name: 'trusted_folders',
  async description() { return 'Manage trusted folder security policy — restrict file operations to approved paths only' },
  async prompt() { return 'Manage trusted folder security policy — restrict file operations to approved paths only' },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return true },
  isReadOnly(input) { return input.action === 'list' || input.action === 'check' },
  async call(input, context, canUseTool, parentMessage) {
    const { action, path } = input
    const cfg = loadConfig()

    switch (action) {
      case 'list':
        return { data: { success: true, action: 'list', paths: cfg.paths, enabled: cfg.enabled } }
      case 'add': {
        if (!path) return { data: { success: false, action: 'add', error: 'path required' } }
        if (!cfg.paths.includes(path)) cfg.paths.push(path)
        saveConfig(cfg)
        return { data: { success: true, action: 'add', paths: cfg.paths } }
      }
      case 'remove': {
        if (!path) return { data: { success: false, action: 'remove', error: 'path required' } }
        cfg.paths = cfg.paths.filter(p => p !== path)
        saveConfig(cfg)
        return { data: { success: true, action: 'remove', paths: cfg.paths } }
      }
      case 'check': {
        if (!path) return { data: { success: false, action: 'check', error: 'path required' } }
        const allowed = !cfg.enabled || cfg.paths.some(p => path.startsWith(p))
        return { data: { success: true, action: 'check', allowed } }
      }
      case 'enable':
        cfg.enabled = true
        saveConfig(cfg)
        return { data: { success: true, action: 'enable', enabled: true } }
      case 'disable':
        cfg.enabled = false
        saveConfig(cfg)
        return { data: { success: true, action: 'disable', enabled: false } }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },

  mapToolResultToToolResultBlockParam(data: z.infer<OutputSchema>, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, Output>)
