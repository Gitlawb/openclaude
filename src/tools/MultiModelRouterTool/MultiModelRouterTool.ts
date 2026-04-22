// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { routeTask, listModels } from '../../orchestrator/multi-model/multi-model-router.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['route', 'list', 'compare']).describe('Router action'),
    task: z.string().optional().describe('Task description to route'),
    complexity: z.number().min(1).max(10).optional().describe('Task complexity 1-10'),
    vision: z.boolean().optional().describe('Needs vision capability'),
    functionCalling: z.boolean().optional().describe('Needs function calling'),
    preferSpeed: z.boolean().optional().describe('Prefer fast models'),
    preferQuality: z.boolean().optional().describe('Prefer quality over speed'),
    maxCost: z.number().optional().describe('Max cost per 1M tokens'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const MultiModelRouterTool = buildTool({
  name: 'router',
  async description() { return 'Multi-model router (Crush CLI pattern) — routes tasks to optimal model across MiniMax, Kimi, OpenAI, Anthropic, OpenRouter, LM Studio. Considers task type, complexity, cost, vision, speed.' },
  async prompt() { return 'Smart model routing across 9+ providers — MiniMax, Kimi, OpenAI, Anthropic, OpenRouter, LM Studio. Use /router route to see best model for a task. Use /router list to see all available models.' },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema() {
    return z.object({
      success: z.boolean(),
      action: z.string(),
      provider: z.string().optional(),
      model: z.string().optional(),
      reason: z.string().optional(),
      costEstimate: z.number().optional(),
      fallback: z.string().optional(),
      models: z.array(z.object({ provider: z.string(), model: z.string(), speed: z.string(), vision: z.boolean() })).optional(),
      error: z.string().optional(),
    })
  },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  async call(input, context, canUseTool, parentMessage) {
    const { action, task, complexity = 5, vision = false, functionCalling = false, preferSpeed, preferQuality, maxCost } = input

    switch (action) {
      case 'route': {
        if (!task) return { data: { success: false, action: 'route', error: 'task required' } }
        const result = routeTask({ task, complexity, vision, functionCalling, maxCost, preferSpeed, preferQuality })
        return {
          data: {
            success: true,
            action: 'route',
            provider: result.provider,
            model: result.model,
            reason: result.reason,
            costEstimate: result.costEstimate,
            fallback: result.fallback ? `${result.fallback.provider}/${result.fallback.model}` : undefined,
          },
        }
      }
      case 'list': {
        const models = listModels()
        return {
          data: {
            success: true,
            action: 'list',
            models: models.map(m => ({ provider: m.provider, model: m.model, speed: m.speed, vision: m.vision, contextWindow: m.contextWindow, cost: `$${m.costPer1MInput}/${m.costPer1MOutput}` })),
          },
        }
      }
      case 'compare': {
        if (!task) return { data: { success: false, action: 'compare', error: 'task required' } }
        const models = listModels().slice(0, 5)
        const results = models.map(m => {
          const r = routeTask({ task, complexity: complexity ?? 5, vision, functionCalling })
          return `${m.provider}/${m.model}: ${r.reason}`
        })
        return { data: { success: true, action: 'compare', models: results } }
      }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },

  mapToolResultToToolResultBlockParam(data: any, toolUseID: string) {
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  },
} satisfies ToolDef<InputSchema, { data: any }>)
