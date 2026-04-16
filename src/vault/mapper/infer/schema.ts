export const LAYER_VALUES = [
  'cli', 'service', 'adapter', 'utility', 'data', 'ui', 'infra', 'unknown',
] as const

export type Layer = (typeof LAYER_VALUES)[number]

export type SemanticResult = {
  summary: string
  responsibilities: string[]
  domain: string
  layer: Layer
  tokensIn: number
  tokensOut: number
  fallback: boolean
}

export const SEMANTIC_JSON_SCHEMA = {
  type: 'object',
  required: ['summary', 'responsibilities', 'domain', 'layer'],
  properties: {
    summary: { type: 'string', maxLength: 160 },
    responsibilities: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 7 },
    domain: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    layer: { type: 'string', enum: [...LAYER_VALUES] },
  },
  additionalProperties: false,
} as const
