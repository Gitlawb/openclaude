// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { createShadowGit } from '../../orchestrator/multi-model/shadow-git.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['checkpoint', 'list', 'restore', 'diff']).describe('Shadow Git action'),
    message: z.string().optional().describe('Checkpoint message'),
    files: z.array(z.string()).optional().describe('Specific files to checkpoint'),
    checkpointId: z.string().optional().describe('Checkpoint ID to restore'),
    file: z.string().optional().describe('Specific file to restore'),
    projectPath: z.string().optional().describe('Project path (default: cwd)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const ShadowGitTool = buildTool({
  name: 'shadow',
  async description() { return 'Shadow Git checkpointing (Gemini CLI pattern) — creates Git snapshots BEFORE file modifications. Stored separately from project Git in ~/.config/openclaude/shadow/. Automatic safety net.' },
  async prompt() { return 'Shadow Git checkpointing — creates safety snapshots before any file change. Use /shadow checkpoint to save state, /shadow list to see checkpoints, /shadow restore to revert. Critical safety tool.' },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema() {
    return z.object({
      success: z.boolean(),
      action: z.string(),
      checkpointId: z.string().optional(),
      checkpoints: z.array(z.object({ id: z.string(), message: z.string(), timestamp: z.string() })).optional(),
      restored: z.boolean().optional(),
      error: z.string().optional(),
    })
  },
  isConcurrencySafe() { return true },
  isReadOnly(input) { return input.action === 'list' },
  async call(input, context, canUseTool, parentMessage) {
    const { action, message, files, checkpointId, file, projectPath } = input
    const shadow = createShadowGit(projectPath)

    switch (action) {
      case 'checkpoint': {
        const ref = shadow.checkpoint(message ?? 'manual checkpoint', files)
        if (!ref) return { data: { success: false, action: 'checkpoint', error: 'Failed to create checkpoint' } }
        return {
          data: {
            success: true,
            action: 'checkpoint',
            checkpointId: ref.id,
          },
        }
      }
      case 'list': {
        const checkpoints = shadow.list()
        return {
          data: {
            success: true,
            action: 'list',
            checkpoints: checkpoints.map(c => ({
              id: c.id,
              message: c.message,
              timestamp: new Date(c.timestamp).toISOString(),
            })),
          },
        }
      }
      case 'restore': {
        if (!checkpointId) return { data: { success: false, action: 'restore', error: 'checkpointId required' } }
        const ok = shadow.restore(checkpointId, file)
        return { data: { success: ok, action: 'restore', restored: ok } }
      }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },

  mapToolResultToToolResultBlockParam(data: any, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, { data: any }>)
