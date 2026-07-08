
function lookupByModel<T>(table: Record<string, T>, model: string): T | undefined {
  // Try provider-qualified key first: "{OPENAI_MODEL}:{model}" so that
  // e.g. "github:copilot:claude-haiku-4.5" can have different limits than
  // a bare "claude-haiku-4.5" served by another provider.
  const providerModel = process.env.OPENAI_MODEL?.trim()
  if (providerModel && providerModel !== model) {
    const qualified = `${providerModel}:${model}`
    const qualifiedResult = lookupByKey(table, qualified)
    if (qualifiedResult !== undefined) return qualifiedResult
  }
  return lookupByKey(table, model)
}

function lookupByKey<T>(table: Record<string, T>, model: string): T | undefined {
  if (table[model] !== undefined) return table[model]
  // Sort keys by length descending so the most specific prefix wins.
  // Without this, 'gpt-4-turbo-preview' could match 'gpt-4' (8k) instead
  // of 'gpt-4-turbo' (128k) depending on V8's key iteration order.
  const sortedKeys = Object.keys(table).sort((a, b) => b.length - a.length)
  for (const key of sortedKeys) {
    if (model.startsWith(key)) return table[key]
  }
  return undefined
}

/**
 * Look up the context window for an OpenAI-compatible model.
 * Returns a reasonable default for unknown OpenAI-compatible models.
 *
 * Falls back to prefix matching so dated variants like
 * "gpt-4o-2024-11-20" resolve to the base "gpt-4o" entry.
 */
export function getOpenAIContextWindow(): number {
  return 128_000;
}

/**
 * Look up the max output tokens for an OpenAI-compatible model.
 * Returns a reasonable default that won't cause 400 errors on
 * most API providers. Can be overridden via CLAUDE_CODE_MAX_OUTPUT_TOKENS.
 */
export function getOpenAIMaxOutputTokens(): number {
  return 16_384;
}
