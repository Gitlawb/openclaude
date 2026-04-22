// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['status', 'start', 'stop', 'dream', 'tick'])
      .describe('KAIROS heartbeat action'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    running: z.boolean().optional(),
    whisper: z.string().optional(),
    patterns: z.array(z.string()).optional(),
    tick: z.number().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

// KAIROS state (in-memory for this session)
let kairosRunning = false
let kairosTick = 0
const kairosPatterns: string[] = []

export const KAIROSTool = buildTool({
  name: 'kairos',
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  async call(input, context, canUseTool, parentMessage) {
    const { action } = input

    switch (action) {
      case 'status':
        return {
          data: {
            success: true,
            action: 'status',
            running: kairosRunning,
            tick: kairosTick,
            patterns: kairosPatterns.length > 0 ? kairosPatterns : undefined,
            message: kairosRunning
              ? `KAIROS heartbeat running (tick ${kairosTick})`
              : 'KAIROS heartbeat stopped',
          },
        }

      case 'start':
        kairosRunning = true
        kairosTick = 0
        return {
          data: {
            success: true,
            action: 'start',
            running: true,
            tick: 0,
            message: 'KAIROS heartbeat started. Use /kairos dream to generate whispers.',
          },
        }

      case 'stop':
        kairosRunning = false
        return {
          data: {
            success: true,
            action: 'stop',
            running: false,
            tick: kairosTick,
            message: `KAIROS heartbeat stopped at tick ${kairosTick}`,
          },
        }

      case 'dream': {
        kairosTick++
        // Pattern recognition simulation - in real impl this would analyze recent sessions
        const dreamWhispers = [
          'User tends to ask about plant monitoring on weekends',
          'Consider proactively checking system health at 2AM',
          'User frequently checks crypto prices in the morning',
          'Weather alerts correlate with user location (Dayton OH)',
          'Pattern: shell commands spike on weekdays at 9AM',
        ]
        const whisper =
          dreamWhispers[kairosTick % dreamWhispers.length] ||
          'Continuous learning active'
        kairosPatterns.push(whisper)
        if (kairosPatterns.length > 10) kairosPatterns.shift()
        return {
          data: {
            success: true,
            action: 'dream',
            running: kairosRunning,
            tick: kairosTick,
            whisper,
            patterns: kairosPatterns,
            message: `Dream consolidation complete (tick ${kairosTick}): ${whisper}`,
          },
        }
      }

      case 'tick': {
        kairosTick++
        return {
          data: {
            success: true,
            action: 'tick',
            running: kairosRunning,
            tick: kairosTick,
            message: `Heartbeat tick ${kairosTick}`,
          },
        }
      }

      default:
        return {
          data: {
            success: false,
            action,
            error: `Unknown action: ${action}`,
          },
        }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
