import type { NoteDraft } from '../../conventions/validator.js'
import type { ModuleDescriptor } from '../types.js'
import { scanEnvReferences } from './envScan.js'

/**
 * Build a vault-conformant module note draft from a fully enriched
 * {@link ModuleDescriptor}.
 *
 * The draft carries all required frontmatter fields per VAULT-SCHEMA.md §3
 * and the 6 fixed body sections per the module template (§10.2):
 *   TL;DR → Public API → Internal design → Dependencies → Configuration → Error handling
 *
 * Confidence mapping:
 * - static-only (no LLM, no fallback) → high
 * - LLM success → medium
 * - LLM fallback → low
 */
export function toModuleNoteDraft(descriptor: ModuleDescriptor): NoteDraft {
  const today = new Date().toISOString().slice(0, 10)
  const filename = `module-${descriptor.slug}`
  const title = descriptor.slug

  const confidence = descriptor.fallback ? 'low' : 'medium'

  const tags = buildTags(descriptor)

  const dependsOnLinks = descriptor.dependsOn.map((s) => `[[module-${s}]]`)
  const dependedByLinks = descriptor.dependedBy.map((s) => `[[module-${s}]]`)

  // _pendingLinks: all module slugs we reference so writeNote doesn't reject them as hallucinated
  const pendingLinks = [
    ...descriptor.dependsOn.map((s) => `module-${s}`),
    ...descriptor.dependedBy.map((s) => `module-${s}`),
  ]

  const frontmatter: Record<string, unknown> = {
    title,
    type: 'module',
    source_path: descriptor.sourcePath,
    language: descriptor.language,
    layer: descriptor.layer,
    domain: descriptor.domain,
    depends_on: dependsOnLinks,
    depended_by: dependedByLinks,
    exports: descriptor.exports,
    status: 'draft',
    created: today,
    updated: today,
    last_verified: today,
    confidence,
    summary: descriptor.summary,
    tags,
    related: [],
    _pendingLinks: pendingLinks,
  }

  const body = buildBody(descriptor)

  return {
    filename,
    folder: 'knowledge',
    frontmatter,
    body,
  }
}

function buildTags(descriptor: ModuleDescriptor): string[] {
  const tags: string[] = [
    'code/module',
    `lang/${descriptor.language}`,
    `layer/${descriptor.layer}`,
    `domain/${descriptor.domain}`,
  ]

  // Pad to minimum 3 if needed (shouldn't be, we already have 4)
  // Cap at 7
  return tags.slice(0, 7)
}

function buildBody(descriptor: ModuleDescriptor): string {
  const sections: string[] = []

  // TL;DR
  sections.push(`> **TL;DR**: ${descriptor.summary}`)

  // Public API
  sections.push('## Public API')
  if (descriptor.exports.length > 0) {
    sections.push(descriptor.exports.map((e) => `- \`${e}\``).join('\n'))
  } else {
    sections.push('No public exports detected.')
  }

  // Internal design
  sections.push('## Internal design')
  if (descriptor.responsibilities.length > 0) {
    sections.push(descriptor.responsibilities.map((r) => `- ${r}`).join('\n'))
  } else {
    sections.push('_Pending analysis._')
  }

  // Dependencies
  sections.push('## Dependencies')
  const internalDeps = descriptor.dependsOn.map((s) => `- [[module-${s}]]`)
  const externalDeps = descriptor.externals.map((e) => `- \`${e}\``)
  if (internalDeps.length > 0) {
    sections.push('**Internal:**')
    sections.push(internalDeps.join('\n'))
  }
  if (externalDeps.length > 0) {
    sections.push('**External:**')
    sections.push(externalDeps.join('\n'))
  }
  if (internalDeps.length === 0 && externalDeps.length === 0) {
    sections.push('None detected.')
  }

  // Configuration
  sections.push('## Configuration')
  const envRefs = scanEnvReferences(descriptor.files)
  if (envRefs.length > 0) {
    sections.push(envRefs.map((r) => `- ${r}`).join('\n'))
  } else {
    sections.push('None detected.')
  }

  // Error handling
  sections.push('## Error handling')
  sections.push('_TODO: pending Change Intelligence pass._')

  return sections.join('\n\n')
}
