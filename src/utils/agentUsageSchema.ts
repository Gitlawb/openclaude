import { z } from 'zod/v4'
import type { AgentTokenUsage } from './agentUsage.js'

export const agentTokenUsageSchema: z.ZodType<AgentTokenUsage> = z.object({
  confirmed: z.number().nonnegative(),
  estimated: z.number().nonnegative(),
  state: z.enum(['pending', 'estimated', 'reported']),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheCreationTokens: z.number().nonnegative(),
})

export function parseAgentUsageMetadata(value: string | undefined): AgentTokenUsage | undefined {
  if (!value) return undefined
  try { const parsed = agentTokenUsageSchema.safeParse(JSON.parse(value)); return parsed.success ? parsed.data : undefined } catch { return undefined }
}
