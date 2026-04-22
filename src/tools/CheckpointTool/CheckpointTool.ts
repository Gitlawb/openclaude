// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { resolve } from 'path'
import { DESCRIPTION } from './prompt.js'

const CHECKPOINT_DIR = process.env.CLAUDE_CODE_TMPDIR
  ? `${process.env.CLAUDE_CODE_TMPDIR}/checkpoints`
  : '/tmp/openclaude-checkpoints'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['save', 'load', 'list', 'auto']).describe('Checkpoint action'),
    name: z.string().optional().describe('Checkpoint name'),
    note: z.string().optional().describe('Checkpoint note'),
    id: z.string().optional().describe('Checkpoint ID to load'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    checkpoints: z.array(z.object({ id: z.string(), name: z.string(), date: z.string() })).optional(),
    checkpointId: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function ensureDir() { mkdirSync(CHECKPOINT_DIR, { recursive: true }) }

export const CheckpointTool = buildTool({
  name: 'checkpoint',
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return true },
  isReadOnly(input) { return input.action !== 'save' },
  async call(input, context, canUseTool, parentMessage) {
    const { action, name, note, id } = input
    ensureDir()

    switch (action) {
      case 'save': {
        const checkpointId = name ?? `session_${Date.now()}`
        const path = resolve(CHECKPOINT_DIR, `checkpoint_${checkpointId}.json`)
        writeFileSync(path, JSON.stringify({ id: checkpointId, date: new Date().toISOString(), note: note ?? '', version: '1.0' }, null, 2), 'utf8')
        return { data: { success: true, action: 'save', checkpointId } }
      }
      case 'load': {
        if (!id) return { data: { success: false, action: 'load', error: 'checkpoint id required' } }
        const path = resolve(CHECKPOINT_DIR, `checkpoint_${id}.json`)
        try {
          const { readFileSync } = require('fs')
          JSON.parse(readFileSync(path, 'utf8'))
          return { data: { success: true, action: 'load', checkpointId: id } }
        } catch {
          return { data: { success: false, action: 'load', error: 'checkpoint not found' } }
        }
      }
      case 'list': {
        const files = readdirSync(CHECKPOINT_DIR).filter((f: string) => f.startsWith('checkpoint_') && f.endsWith('.json')).slice(-20).reverse()
        const checkpoints = files.map((f: string) => {
          const id = f.replace('checkpoint_', '').replace('.json', '')
          const stat = statSync(resolve(CHECKPOINT_DIR, f))
          return { id, name: id, date: stat.mtime.toISOString() }
        })
        return { data: { success: true, action: 'list', checkpoints } }
      }
      case 'auto': {
        const checkpointId = `auto_${Date.now()}`
        const path = resolve(CHECKPOINT_DIR, `checkpoint_${checkpointId}.json`)
        writeFileSync(path, JSON.stringify({ id: checkpointId, date: new Date().toISOString(), note: note ?? 'auto-checkpoint', type: 'auto' }, null, 2), 'utf8')
        return { data: { success: true, action: 'auto', checkpointId } }
      }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },

  mapToolResultToToolResultBlockParam(data: z.infer<OutputSchema>, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, Output>)
