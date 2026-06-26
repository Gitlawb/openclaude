import type { OpenAIShimTransportConfig } from '../descriptors.js'

/**
 * Z.AI (GLM) reasoning-compatible OpenAI-shim contract.
 *
 * Single source of truth for the request shaping GLM reasoning models need:
 * preserved/echoed reasoning content, the zai-compatible thinking format,
 * `max_tokens`, and stripping the unsupported `store` field.
 *
 * Applied explicitly via `transportOverrides.openaiShim` on catalog entries of
 * Z.AI-contract GLM routes (e.g. opencode-go, atlas-cloud). The name-based
 * matcher only infers this for non-catalog routes (direct/aggregator aliases),
 * so catalog-backed non-Z.AI GLM entries (nearai, fireworks) keep their own
 * provider-specific request shape.
 */
export const ZAI_GLM_OPENAI_SHIM = {
  preserveReasoningContent: true,
  requireReasoningContentOnAssistantMessages: true,
  reasoningContentFallback: '',
  thinkingRequestFormat: 'zai-compatible',
  maxTokensField: 'max_tokens',
  removeBodyFields: ['store'],
  enableToolStreaming: true,
} as const satisfies Partial<OpenAIShimTransportConfig>
