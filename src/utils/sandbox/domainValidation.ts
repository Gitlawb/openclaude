import { NetworkConfigSchema } from '@anthropic-ai/sandbox-runtime'

/** Validate a live approval with the same schema used at runtime startup. */
export function normalizeSandboxDomainPattern(domain: string): string | null {
  const normalized = domain.trim()
  if (!normalized) return null
  return NetworkConfigSchema.shape.allowedDomains.safeParse([normalized])
    .success
    ? normalized
    : null
}
