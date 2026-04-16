import type { Layer } from './infer/schema.js'

export type ModuleCandidate = {
  slug: string
  sourcePath: string
  files: string[]
  language: 'typescript' | 'javascript'
}

/**
 * Fully enriched module descriptor — the combined output of static analysis
 * (T5–T7) and semantic inference (T4/T13). Consumed by emit/ to produce
 * vault note drafts.
 */
export type ModuleDescriptor = {
  slug: string
  sourcePath: string
  files: string[]
  language: 'typescript' | 'javascript'
  exports: string[]
  dependsOn: string[]
  dependedBy: string[]
  externals: string[]
  /** Semantic fields — populated by LLM or fallback placeholders. */
  summary: string
  responsibilities: string[]
  domain: string
  layer: Layer
  /** True when the LLM pass failed and fallback placeholders were used. */
  fallback: boolean
}
