import type { ModelCatalogEntry } from '../../integrations/descriptors.js'
import { parseModelList } from '../providerModels.js'
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

/**
 * Append models the user typed into their provider profile's model field
 * (comma- or semicolon-separated) onto a catalog entry list, skipping any
 * that already exist by apiName (case-insensitive). Synthetic entries carry
 * only id/apiName/label so they can flow through the same picker pipeline
 * as descriptor-backed entries.
 */
export function mergeProfileConfiguredModels(
  entries: ModelCatalogEntry[],
  profileModelField: string | undefined,
): ModelCatalogEntry[] {
  if (!profileModelField) {
    return entries
  }

  const configured = parseModelList(profileModelField)
  if (configured.length === 0) {
    return entries
  }

  const merged = [...entries]
  const existingApiNames = new Set(
    entries.map(entry => entry.apiName.toLowerCase()),
  )

  for (const model of configured) {
    const key = model.toLowerCase()
    if (existingApiNames.has(key)) {
      continue
    }

    existingApiNames.add(key)
    merged.push({
      id: `profile-${model}`,
      apiName: model,
      label: model,
      modelDescriptorId: model,
    })
  }

  return merged
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
