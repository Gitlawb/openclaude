import { runWithLimit } from '../../../utils/pLimit.js'
import { coerceSemanticResponse, type SemanticResult } from './coerce.js'
import { callSemanticPass, type SemanticProvider, type SemanticCallOpts } from './semanticCall.js'
import type { PromptInput } from './promptBuilder.js'

export interface InferBatchOpts extends SemanticCallOpts {
  concurrency?: number
}

/**
 * Run the semantic LLM pass for multiple modules in parallel,
 * bounded by `concurrency` (default 4).
 *
 * Failures are coerced to fallback results — the batch never throws.
 * Results are returned in the same order as the input.
 */
export async function inferBatch(
  inputs: PromptInput[],
  provider: SemanticProvider,
  opts: InferBatchOpts = {},
): Promise<SemanticResult[]> {
  const concurrency = opts.concurrency ?? 4

  const tasks = inputs.map((input) => () => callSemanticPass(input, provider, opts))

  const settled = await runWithLimit(tasks, concurrency)

  return settled.map((r) => {
    if (r.status === 'fulfilled') return r.value
    // Should not happen since callSemanticPass never throws, but just in case
    return coerceSemanticResponse(null, 0, 0)
  })
}
