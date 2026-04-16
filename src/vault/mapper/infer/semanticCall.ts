import { buildSemanticPrompt, type PromptInput } from './promptBuilder.js'
import { coerceSemanticResponse, type SemanticResult } from './coerce.js'
import type { SEMANTIC_JSON_SCHEMA } from './schema.js'

/**
 * Minimal provider interface for the mapper's semantic LLM pass.
 * Decoupled from the full API client so it can be easily stubbed in tests
 * and wired to any provider in the pipeline.
 */
export interface SemanticProvider {
  complete(opts: {
    systemPrompt: string
    userPrompt: string
    schema: typeof SEMANTIC_JSON_SCHEMA
  }): Promise<{
    content: string
    tokensIn: number
    tokensOut: number
  }>
}

export interface SemanticCallOpts {
  /** When true, skip the provider call entirely and return fallback. */
  disableLlm?: boolean
}

/**
 * Call the LLM for one module's semantic analysis.
 *
 * 1. Build prompt from input
 * 2. Call provider with structured output
 * 3. Parse + validate response via coerce
 * 4. Retry ONCE on invalid JSON / schema violation
 * 5. Fall back to placeholders on second failure
 */
export async function callSemanticPass(
  input: PromptInput,
  provider: SemanticProvider,
  opts: SemanticCallOpts = {},
): Promise<SemanticResult> {
  if (opts.disableLlm) {
    return coerceSemanticResponse(null, 0, 0)
  }

  const { systemPrompt, userPrompt, schema } = buildSemanticPrompt(input)

  // First attempt
  const firstResult = await attemptCall(provider, systemPrompt, userPrompt, schema)
  if (firstResult.ok) return firstResult.value

  // Retry once
  const retryResult = await attemptCall(provider, systemPrompt, userPrompt, schema)
  if (retryResult.ok) return retryResult.value

  // Both failed — return fallback with accumulated token counts from both attempts
  return coerceSemanticResponse(
    null,
    firstResult.tokensIn + retryResult.tokensIn,
    firstResult.tokensOut + retryResult.tokensOut,
  )
}

type AttemptResult =
  | { ok: true; value: SemanticResult }
  | { ok: false; tokensIn: number; tokensOut: number; reason: string }

async function attemptCall(
  provider: SemanticProvider,
  systemPrompt: string,
  userPrompt: string,
  schema: typeof SEMANTIC_JSON_SCHEMA,
): Promise<AttemptResult> {
  let tokensIn = 0
  let tokensOut = 0

  try {
    const response = await provider.complete({ systemPrompt, userPrompt, schema })
    tokensIn = response.tokensIn
    tokensOut = response.tokensOut

    const parsed = JSON.parse(response.content)
    const result = coerceSemanticResponse(parsed, tokensIn, tokensOut)

    if (result.fallback) {
      return { ok: false, tokensIn, tokensOut, reason: 'schema-validation-failed' }
    }

    return { ok: true, value: result }
  } catch (err) {
    return {
      ok: false,
      tokensIn,
      tokensOut,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}
