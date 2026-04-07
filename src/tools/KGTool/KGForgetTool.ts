/**
 * KGForgetTool — mark a knowledge graph node stale during a session.
 *
 * Use when a previously memorized fact has been superseded or is no longer
 * accurate. Prefer KGMemorize with supersedes_id when writing a replacement
 * at the same time — that atomically marks the old node stale and links them.
 *
 * Use KGForget standalone when:
 * - The fact is simply wrong and has no replacement yet
 * - You want to clean up during the session before writing a fresh version
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getDb, markStale } from '../../kg/db.js'
import { recallNode } from '../../kg/traversal.js'

export const KG_FORGET_TOOL_NAME = 'KGForget'

const DESCRIPTION = [
  'Mark a knowledge graph node as stale (forgotten).',
  '',
  'Use when a memorized fact is no longer accurate and has no replacement yet.',
  'If you have a replacement, use KGMemorize with supersedes_id instead —',
  'that atomically marks the old node stale and links the two.',
  '',
  'Accepts partial IDs — the first 4+ characters are sufficient.',
].join('\n')

const inputSchema = lazySchema(() =>
  z.strictObject({
    id: z
      .string()
      .describe(
        'Node ID to mark stale. Partial prefix is fine. ' +
        'IDs appear as [m:<id>] in the Context Manifest.',
      ),
    reason: z
      .string()
      .optional()
      .describe('Why this memory is being forgotten (logged, not stored).'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    forgotten_id: z.string(),
    label: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type KGForgetOutput = z.infer<OutputSchema>

export const KGForgetTool = buildTool({
  name: KG_FORGET_TOOL_NAME,
  searchHint: 'mark a knowledge graph memory as stale or forgotten',
  maxResultSizeChars: 5_000,

  async description() {
    return DESCRIPTION
  },

  async prompt() {
    return DESCRIPTION
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isReadOnly() {
    return false
  },

  isConcurrencySafe() {
    return false
  },

  userFacingName() {
    return KG_FORGET_TOOL_NAME
  },

  getToolUseSummary(input) {
    return input?.id ? `forget(${input.id})` : 'forget'
  },

  getActivityDescription(input) {
    return input?.id ? `Forgetting [m:${input.id}]` : 'Forgetting memory'
  },

  toAutoClassifierInput(input) {
    return `forget: ${input.id}`
  },

  renderToolUseMessage() {
    return null
  },

  renderToolUseErrorMessage() {
    return null
  },

  async call(input) {
    const agentId = process.env.OPENCLAUDE_AGENT_ID ?? 'default'
    const db = getDb(agentId)

    // Resolve partial ID first so we can return the label
    const row = db
      .query(`SELECT id, label FROM nodes WHERE id LIKE $pattern LIMIT 1`)
      .get({ $pattern: `${input.id}%` }) as { id: string; label: string } | undefined

    if (!row) {
      throw new Error(`No node found matching id prefix "${input.id}"`)
    }

    markStale(db, row.id)

    if (input.reason) {
      console.error(`[kg] forgot [m:${row.id}] "${row.label}" — ${input.reason}`)
    }

    return { data: { forgotten_id: row.id, label: row.label } }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Forgot [m:${output.forgotten_id}]: ${output.label}`,
    }
  },
} satisfies ToolDef<InputSchema, KGForgetOutput>)
