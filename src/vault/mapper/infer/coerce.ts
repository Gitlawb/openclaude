import { LAYER_VALUES, type Layer, type SemanticResult } from './schema.js'

const LAYER_SET = new Set<string>(LAYER_VALUES)

const FALLBACK_RESULT: SemanticResult = {
  summary: 'Module pending semantic analysis.',
  responsibilities: ['To be determined', 'To be determined', 'To be determined'],
  domain: 'unclassified',
  layer: 'unknown',
  tokensIn: 0,
  tokensOut: 0,
  fallback: true,
}

/**
 * Coerce a raw LLM response into a valid SemanticResult.
 * Returns fallback placeholders when the input is null, malformed,
 * or fails validation.
 */
export function coerceSemanticResponse(
  raw: unknown,
  tokensIn: number = 0,
  tokensOut: number = 0,
): SemanticResult {
  if (raw == null || typeof raw !== 'object') {
    return { ...FALLBACK_RESULT, tokensIn, tokensOut }
  }

  const obj = raw as Record<string, unknown>

  const summary = typeof obj.summary === 'string' ? obj.summary.slice(0, 160) : null
  const responsibilities = coerceResponsibilities(obj.responsibilities)
  const domain = coerceDomain(obj.domain)
  const layer = coerceLayer(obj.layer)

  if (!summary || !responsibilities || !domain) {
    return { ...FALLBACK_RESULT, tokensIn, tokensOut }
  }

  return {
    summary,
    responsibilities,
    domain,
    layer,
    tokensIn,
    tokensOut,
    fallback: false,
  }
}

function coerceResponsibilities(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const items = raw.filter((x): x is string => typeof x === 'string' && x.length > 0)
  if (items.length < 3) return null
  return items.slice(0, 7)
}

function coerceDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  if (!/^[a-z][a-z0-9-]*$/.test(trimmed)) return null
  return trimmed
}

function coerceLayer(raw: unknown): Layer {
  if (typeof raw === 'string' && LAYER_SET.has(raw)) return raw as Layer
  return 'unknown'
}
