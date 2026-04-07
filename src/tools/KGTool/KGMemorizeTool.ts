/**
 * KGMemorizeTool — write loop for the knowledge graph.
 *
 * The agent calls this to persist facts, learned rules, and decisions into
 * its own graph. This closes the write loop: the graph starts seeded with
 * defaults (seed.ts) and grows richer with each session.
 *
 * Node types the agent can write:
 *   fact  — a decision, observed state, or piece of knowledge
 *   rule  — a behavioral instruction discovered through experience
 *
 * Persona nodes, tool nodes, and example nodes are structural — managed via
 * seed.ts and the graph admin CLI, not self-written by the agent.
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getDb, upsertNode, upsertEdge, markStale, type NodeType } from '../../kg/db.js'

export const KG_MEMORIZE_TOOL_NAME = 'KGMemorize'

const DESCRIPTION = [
  'Save a fact or behavioral rule to your persistent knowledge graph.',
  '',
  'Use this to remember:',
  '- Decisions and their rationale ("user prefers bun over npm — confirmed after correction")',
  '- Project context not in the code ("auth rewrite is driven by legal compliance, not tech debt")',
  '- Behavioral adjustments learned from user feedback ("stop adding trailing summaries")',
  '- Time-bounded state ("main branch is frozen until 2026-04-10")',
  '',
  'Do NOT use for:',
  '- Code patterns or architecture (read the code instead)',
  '- Git history (use git log)',
  '- Anything already in CLAUDE.md or project docs',
  '',
  'Set supersedes_id to replace an existing stale fact with an updated one.',
].join('\n')

const inputSchema = lazySchema(() =>
  z.strictObject({
    label: z
      .string()
      .describe(
        'One-line summary shown in the Context Manifest (e.g., "user prefers bun over npm").',
      ),
    content: z
      .string()
      .describe('Full content of the memory. Can be multiple sentences.'),
    type: z
      .enum(['fact', 'rule'])
      .describe(
        '"fact" for decisions, observed state, or knowledge. ' +
        '"rule" for behavioral instructions discovered through experience.',
      ),
    valid_hours: z
      .number()
      .optional()
      .describe(
        'How many hours this memory should remain fresh. ' +
        'Omit for permanent memories. Use for time-bounded facts ' +
        '(e.g., 24 for "server is down today").',
      ),
    supersedes_id: z
      .string()
      .optional()
      .describe(
        'ID of an existing node this memory replaces. ' +
        'The old node will be marked stale and linked via a SUPERSEDES edge.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    id: z.string().describe('Content-addressed ID of the new node.'),
    label: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type KGMemorizeOutput = z.infer<OutputSchema>

export const KGMemorizeTool = buildTool({
  name: KG_MEMORIZE_TOOL_NAME,
  searchHint: 'save a fact or rule to the agent knowledge graph',
  maxResultSizeChars: 10_000,

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
    return KG_MEMORIZE_TOOL_NAME
  },

  getToolUseSummary(input) {
    return input?.label ? `memorize("${input.label}")` : 'memorize'
  },

  getActivityDescription(input) {
    return input?.label ? `Memorizing: ${input.label}` : 'Memorizing'
  },

  toAutoClassifierInput(input) {
    return `${input.type}: ${input.label}`
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
    const now = Date.now()

    const valid_until = input.valid_hours != null
      ? now + input.valid_hours * 3_600_000
      : null

    const id = upsertNode(db, {
      type: input.type as NodeType,
      label: input.label,
      content: input.content,
      created_at: now,
      valid_until,
      stale: 0,
    })

    if (input.supersedes_id) {
      markStale(db, input.supersedes_id)
      upsertEdge(db, {
        from_id: id,
        to_id: input.supersedes_id,
        type: 'SUPERSEDES',
        weight: 1.0,
      })
    }

    return { data: { id, label: input.label } }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Saved [m:${output.id}]: ${output.label}`,
    }
  },
} satisfies ToolDef<InputSchema, KGMemorizeOutput>)
