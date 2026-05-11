import type { ModelCatalogEntry } from '../../integrations/descriptors.js'
import type { ModelOption } from './modelOptions.js'

function toDescription(
  entry: ModelCatalogEntry,
  routeLabel: string,
  routeDefaultModel?: string,
): string {
  const parts: string[] = []
  const isRecommended =
    entry.default ||
    (routeDefaultModel !== undefined &&
      entry.apiName.trim().toLowerCase() === routeDefaultModel.trim().toLowerCase())

  if (isRecommended) {
    parts.push('Recommended')
  }
  parts.push(`Provider: ${routeLabel}`)

  return parts.join(' · ')
}

export function mergeRouteCatalogEntries(
  staticEntries: ModelCatalogEntry[],
  discoveredEntries: ModelCatalogEntry[],
): ModelCatalogEntry[] {
  const merged = [...staticEntries]
  const existingApiNames = new Set(
    staticEntries.map(entry => entry.apiName.toLowerCase()),
  )

  for (const entry of discoveredEntries) {
    if (existingApiNames.has(entry.apiName.toLowerCase())) {
      continue
    }

    existingApiNames.add(entry.apiName.toLowerCase())
    merged.push(entry)
  }

  return merged
}

export function buildRouteCatalogModelOptions(
  routeLabel: string,
  entries: ModelCatalogEntry[],
  routeDefaultModel?: string,
): ModelOption[] {
  const seen = new Set<string>()
  const options: ModelOption[] = []

  for (const entry of entries) {
    const value = entry.apiName.trim()
    if (!value || seen.has(value.toLowerCase())) {
      continue
    }

    seen.add(value.toLowerCase())
    const label = entry.label?.trim() || value
    const description = toDescription(entry, routeLabel, routeDefaultModel)

    options.push({
      value,
      label,
      description,
      descriptionForModel:
        label === value
          ? description
          : `${description} (${value})`,
    })
  }

  return options
}
