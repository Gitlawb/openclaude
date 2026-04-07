/**
 * KGRecallTool — on-demand full retrieval from the knowledge graph.
 *
 * In manifest mode the system prompt only injects IDs + one-line summaries.
 * When the agent needs full content (rules, examples, tool descriptions) it
 * calls KGRecall with a partial or full node ID. This is the runtime
 * complement to renderManifest().
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getDb } from '../../kg/db.js'
import { recallNode } from '../../kg/traversal.js'

export const KG_RECALL_TOOL_NAME = 'KGRecall'

const DESCRIPTION = [
  'Retrieve the full content of a knowledge graph node by ID.',
  '',
  'Use when the Context Manifest shows [m:<id>] entries and you need the',
  'full text: rule body, tool description, examples, or related facts.',
  '',
  'Accepts partial IDs — the first 4+ characters are sufficient.',
].join('\n')

const inputSchema = lazySchema(() =>
  z.strictObject({
    id: z
      .string()
      .describe(
        'Node ID to retrieve. Partial prefix is fine — "233fa2" instead of "233fa21aad2f". ' +
        'IDs appear as [m:<id>] in the Context Manifest.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    content: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type KGRecallOutput = z.infer<OutputSchema>

export const KGRecallTool = buildTool({
  name: KG_RECALL_TOOL_NAME,
  searchHint: 'recall full content of a knowledge graph memory node',
  maxResultSizeChars: 50_000,

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
    return true
  },

  isConcurrencySafe() {
    return true
  },

  userFacingName() {
    return KG_RECALL_TOOL_NAME
  },

  getToolUseSummary(input) {
    return input?.id ? `recall(${input.id})` : 'recall'
  },

  getActivityDescription(input) {
    return input?.id ? `Recalling [m:${input.id}]` : 'Recalling memory'
  },

  toAutoClassifierInput(input) {
    return input.id
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
    const content = recallNode(db, input.id)
    return { data: { content } }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.content,
    }
  },
} satisfies ToolDef<InputSchema, KGRecallOutput>)
