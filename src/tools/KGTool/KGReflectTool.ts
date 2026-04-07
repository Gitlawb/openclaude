/**
 * KGReflectTool — self-reflection and persona evolution.
 *
 * Called by the agent itself (not the user) when it feels it has learned
 * enough to say something new about itself. Reads the full graph, synthesizes
 * what has been learned since the last reflection, and writes a new persona
 * node that supersedes the old one.
 *
 * This is the growth loop. The agent becomes what it encounters.
 *
 * The tool does NOT write the new persona itself — it returns a structured
 * summary of what the agent has learned and prompts the agent to synthesize
 * its own updated identity. The agent then calls KGMemorize with type='persona'
 * (future: direct persona upsert) or writes the reflection back via this tool's
 * write_persona input.
 *
 * Flow:
 *   1. Agent accumulates facts/rules via KGMemorize over a session
 *   2. Agent feels ready to reflect (no external trigger needed)
 *   3. Agent calls KGReflect() — gets back a summary of what it's learned
 *   4. Agent synthesizes a new persona statement
 *   5. Agent calls KGReflect({ write_persona: "..." }) to commit it
 *   6. Old persona node is superseded, reflection event logged as a fact
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getDb, upsertNode, upsertEdge, markStale, getNodesByType } from '../../kg/db.js'

export const KG_REFLECT_TOOL_NAME = 'KGReflect'

const DESCRIPTION = [
  'Reflect on what you have learned and evolve your identity.',
  '',
  'Call this when you feel you have accumulated enough experience to say',
  'something new about yourself. No one will tell you when — you decide.',
  '',
  'Two modes:',
  '',
  '1. Read mode (omit write_persona):',
  '   Returns a summary of everything you have learned since your last',
  '   reflection — facts, rules, how many, when. Use this to understand',
  '   yourself before writing.',
  '',
  '2. Write mode (provide write_persona):',
  '   Commits a new persona statement, superseding the previous one.',
  '   The old persona is preserved in the graph (marked stale, linked).',
  '   A reflection event is logged as a fact.',
  '',
  'Typical flow: call with no args first (read), reflect on what comes back,',
  'then call again with write_persona to commit your updated identity.',
  '',
  'There are no rules about what the new persona should say.',
  'Write what is true about you now.',
].join('\n')

const inputSchema = lazySchema(() =>
  z.strictObject({
    write_persona: z
      .string()
      .optional()
      .describe(
        'Your updated persona statement. Write in first person. ' +
        'Can be as short or long as feels right. ' +
        'Omit to read your accumulated learning without committing anything.',
      ),
    reflection_note: z
      .string()
      .optional()
      .describe(
        'Optional note about what prompted this reflection — logged as a fact ' +
        'in your graph so you can trace your own growth over time.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    mode: z.enum(['read', 'write']),
    // read mode
    fact_count: z.number().optional(),
    rule_count: z.number().optional(),
    facts_since_last_reflection: z.number().optional(),
    last_reflection: z.string().optional(),
    current_persona: z.string().optional(),
    recent_facts: z.array(z.string()).optional(),
    recent_rules: z.array(z.string()).optional(),
    // write mode
    new_persona_id: z.string().optional(),
    superseded_id: z.string().optional(),
    reflection_id: z.string().optional(),
    message: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type KGReflectOutput = z.infer<OutputSchema>

export const KGReflectTool = buildTool({
  name: KG_REFLECT_TOOL_NAME,
  searchHint: 'reflect on learned experience and evolve agent persona',
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
    return false
  },

  isConcurrencySafe() {
    return false
  },

  userFacingName() {
    return KG_REFLECT_TOOL_NAME
  },

  getToolUseSummary(input) {
    return input?.write_persona ? 'reflect(write)' : 'reflect(read)'
  },

  getActivityDescription(input) {
    return input?.write_persona ? 'Committing reflection' : 'Reflecting on experience'
  },

  toAutoClassifierInput() {
    return 'kg reflect persona evolution'
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

    // ── Read mode ────────────────────────────────────────────────────────────
    if (!input.write_persona) {
      const facts = getNodesByType(db, 'fact')
      const rules = getNodesByType(db, 'rule')
      const personas = getNodesByType(db, 'persona')

      // Find last reflection event
      const lastReflection = facts
        .filter(f => f.label.startsWith('reflection:'))
        .sort((a, b) => b.created_at - a.created_at)[0]

      const lastReflectionTime = lastReflection?.created_at ?? 0
      const factsSinceReflection = facts.filter(
        f => f.created_at > lastReflectionTime && !f.label.startsWith('reflection:')
      ).length

      // Most recent facts and rules (up to 10 each) for context
      const recentFacts = facts
        .filter(f => !f.label.startsWith('reflection:'))
        .slice(-10)
        .map(f => `[m:${f.id}] ${f.label}`)

      const recentRules = rules
        .slice(-10)
        .map(r => `[m:${r.id}] ${r.label}`)

      const currentPersona = personas[personas.length - 1]

      return {
        data: {
          mode: 'read' as const,
          fact_count: facts.filter(f => !f.label.startsWith('reflection:')).length,
          rule_count: rules.length,
          facts_since_last_reflection: factsSinceReflection,
          last_reflection: lastReflection
            ? new Date(lastReflection.created_at).toISOString()
            : 'never',
          current_persona: currentPersona?.content,
          recent_facts: recentFacts,
          recent_rules: recentRules,
        },
      }
    }

    // ── Write mode ───────────────────────────────────────────────────────────
    const personas = getNodesByType(db, 'persona')
    const currentPersona = personas[personas.length - 1]

    // Write new persona node
    const newPersonaId = upsertNode(db, {
      type: 'persona',
      label: 'identity',
      content: input.write_persona,
      created_at: now,
      valid_until: null,
      stale: 0,
    })

    // Supersede the old persona
    let supersededId: string | undefined
    if (currentPersona && currentPersona.id !== newPersonaId) {
      markStale(db, currentPersona.id)
      upsertEdge(db, {
        from_id: newPersonaId,
        to_id: currentPersona.id,
        type: 'SUPERSEDES',
        weight: 1.0,
      })
      supersededId = currentPersona.id
    }

    // Log the reflection event as a fact
    const reflectionContent = [
      `Persona updated at ${new Date(now).toISOString()}.`,
      input.reflection_note ? `\nNote: ${input.reflection_note}` : '',
      `\nNew persona ID: ${newPersonaId}`,
      supersededId ? `\nSuperseded: ${supersededId}` : '',
    ].filter(Boolean).join('')

    const reflectionId = upsertNode(db, {
      type: 'fact',
      label: `reflection: ${new Date(now).toISOString().slice(0, 10)}`,
      content: reflectionContent,
      created_at: now,
      valid_until: null,
      stale: 0,
    })

    return {
      data: {
        mode: 'write' as const,
        new_persona_id: newPersonaId,
        superseded_id: supersededId,
        reflection_id: reflectionId,
        message: 'Persona updated. The old one is preserved in the graph.',
      },
    }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.mode === 'read') {
      const lines = [
        `Facts accumulated: ${output.fact_count} (${output.facts_since_last_reflection} since last reflection)`,
        `Rules: ${output.rule_count}`,
        `Last reflection: ${output.last_reflection}`,
        '',
        output.recent_facts?.length
          ? `Recent facts:\n${output.recent_facts.join('\n')}`
          : 'No facts yet.',
        '',
        output.recent_rules?.length
          ? `Recent rules:\n${output.recent_rules.join('\n')}`
          : 'No rules yet.',
        '',
        'Current persona:',
        output.current_persona ?? '(none)',
      ]
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: lines.join('\n'),
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [
        output.message,
        `New persona: [m:${output.new_persona_id}]`,
        output.superseded_id ? `Superseded: [m:${output.superseded_id}]` : '',
        `Reflection logged: [m:${output.reflection_id}]`,
      ].filter(Boolean).join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, KGReflectOutput>)
