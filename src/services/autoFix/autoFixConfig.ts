import { z } from 'zod/v4'

export const AutoFixConfigSchema = z
  .object({
    enabled: z.boolean().describe('Whether auto-fix is enabled'),
    lint: z
      .string()
      .optional()
      .describe('Lint command to run after file edits (e.g. "eslint . --fix")'),
    test: z
      .string()
      .optional()
      .describe('Test command to run after file edits (e.g. "bun test")'),
    maxRetries: z
      .number()
      .int()
      .min(0)
      .max(10)
      .default(3)
      .describe('Maximum number of auto-fix retry attempts (default: 3)'),
    timeout: z
      .number()
      .int()
      .min(1000)
      .max(300000)
      .default(30000)
      .describe('Timeout in ms for each lint/test command (default: 30000)'),
  })
  .refine(
    data => !data.enabled || data.lint !== undefined || data.test !== undefined,
    {
      message: 'At least one of "lint" or "test" must be set when enabled',
    },
  )

export type AutoFixConfig = z.infer<typeof AutoFixConfigSchema>

export function getAutoFixConfig(
  rawConfig: unknown,
): AutoFixConfig | null {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return null
  }
  const parsed = AutoFixConfigSchema.safeParse(rawConfig)
  if (!parsed.success) {
    return null
  }
  if (!parsed.data.enabled) {
    return null
  }
  return parsed.data
}
