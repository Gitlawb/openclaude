// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { createHybridOrchestrator } from '../../orchestrator/hybrid/index.js'

const orchestrator = createHybridOrchestrator()

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['analyze', 'route', 'plan', 'status']).describe('Orchestrator action'),
    message: z.string().optional().describe('User message to analyze'),
    history: z.array(z.object({ role: z.string(), content: z.string() })).optional().describe('Conversation history'),
    tools: z.array(z.string()).optional().describe('Requested tools'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Output = { data: { success: boolean; complexity?: number; category?: string; model?: string; reason?: string; plan?: string[]; council?: boolean; councilReasons?: string[]; checkpoint?: boolean; error?: string } }

export const OrchestrateTool = buildTool({
  name: 'orchestrate',
  async description() { return 'Smart task routing — analyzes complexity, selects model, triggers council for critical tasks, saves checkpoints for long tasks. Powered by Hybrid Orchestrator.' },
  async prompt() { return 'Smart task routing with complexity scoring, model selection, council deliberation, and checkpointing. Use /orchestrate analyze to classify a task before execution.' },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema() { return z.object({ success: z.boolean(), complexity: z.number().optional(), category: z.string().optional(), model: z.string().optional(), reason: z.string().optional(), plan: z.array(z.string()).optional(), council: z.boolean().optional(), councilReasons: z.array(z.string()).optional(), checkpoint: z.boolean().optional(), error: z.string().optional() }) },
  isConcurrencySafe() { return true },
  isReadOnly(input) { return input.action === 'analyze' || input.action === 'status' },
  async call(input, context, canUseTool, parentMessage) {
    const { action, message, history = [], tools = [] } = input

    switch (action) {
      case 'analyze':
      case 'route':
      case 'plan': {
        if (!message) return { data: { success: false, error: 'message required for analyze/route/plan' } }
        const routing = orchestrator.analyze(message, history, tools)
        return {
          data: {
            success: true,
            complexity: routing.analysis.complexity,
            category: routing.analysis.category,
            model: routing.routing.model,
            reason: routing.routing.reason,
            plan: routing.executionPlan,
            council: routing.analysis.needsCouncil,
            councilReasons: routing.analysis.councilReasons,
            checkpoint: routing.analysis.needsCheckpoint,
          },
        }
      }
      case 'status':
        return { data: { success: true, complexity: 0, category: 'ready', model: 'minimax-portal/MiniMax-M2.7', council: false } }
      default:
        return { data: { success: false, error: `Unknown action: ${action}` } }
    }
  },

  mapToolResultToToolResultBlockParam(data: { data: { success: boolean; complexity?: number; category?: string; model?: string; reason?: string; plan?: string[]; council?: boolean; councilReasons?: string[]; checkpoint?: boolean; error?: string } }, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, Output>)
