import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject } from 'ajv'

import modelCatalogSchema from './schema.json' with { type: 'json' }
import type {
  ModelCatalogConfig,
  RouteCatalogValidationOptions,
  RouteCatalogValidationResult,
} from './types.js'

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
})

const validateCatalogShape = ajv.compile(modelCatalogSchema)

export function validateModelCatalogConfig(
  catalog: unknown,
  options: RouteCatalogValidationOptions = {},
): RouteCatalogValidationResult {
  const errors: string[] = []

  const shapeIsValid = validateCatalogShape(catalog)
  if (!shapeIsValid) {
    errors.push(...formatAjvErrors(validateCatalogShape.errors ?? []))
  }

  if (shapeIsValid && isCatalogLike(catalog)) {
    errors.push(...validateCatalogRuntimeValues(catalog))

    if (options.validateSemantics !== false) {
      errors.push(...validateRouteCatalogSemantics(catalog, options))
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export const validateRouteCatalogConfig = validateModelCatalogConfig

function validateRouteCatalogSemantics(
  catalog: ModelCatalogConfig,
  options: RouteCatalogValidationOptions,
): string[] {
  const errors: string[] = []
  const routeLabel = options.routeId ? ` in route "${options.routeId}"` : ''
  const seenEntryIds = new Map<string, string>()
  const seenApiNames = new Map<string, string>()
  const knownModelIds = options.knownModelIds
    ? new Set(Array.from(options.knownModelIds))
    : undefined
  let defaultCount = 0

  for (const entry of catalog.models ?? []) {
    const entryId = entry.id.trim()
    const apiName = entry.apiName.trim()

    if (!entryId) {
      errors.push(`Catalog entry${routeLabel} has an empty id`)
    } else {
      const normalizedEntryId = normalizeReference(entryId)
      const previousEntryId = seenEntryIds.get(normalizedEntryId)
      if (previousEntryId) {
        errors.push(
          `Duplicate catalog entry id "${entry.id}"${routeLabel}; first used by "${previousEntryId}"`,
        )
      } else {
        seenEntryIds.set(normalizedEntryId, entry.id)
      }
    }

    if (!apiName) {
      errors.push(`Catalog entry "${entry.id}"${routeLabel} has an empty apiName`)
    } else {
      const normalizedApiName = normalizeReference(apiName)
      const previousApiName = seenApiNames.get(normalizedApiName)
      if (previousApiName) {
        errors.push(
          `Duplicate catalog apiName "${entry.apiName}"${routeLabel}; first used by "${previousApiName}"`,
        )
      } else {
        seenApiNames.set(normalizedApiName, entry.id)
      }
    }

    if (entry.default) {
      defaultCount++
    }

    if (
      knownModelIds &&
      entry.modelDescriptorId &&
      !knownModelIds.has(entry.modelDescriptorId)
    ) {
      errors.push(
        `Catalog entry "${entry.id}"${routeLabel} references missing model descriptor "${entry.modelDescriptorId}"`,
      )
    }
  }

  if (defaultCount > 1) {
    errors.push(`Catalog${routeLabel} has ${defaultCount} default entries`)
  }

  return errors
}

function validateCatalogRuntimeValues(catalog: ModelCatalogConfig): string[] {
  const errors: string[] = []

  if (
    catalog.discovery &&
    'mapModel' in catalog.discovery &&
    catalog.discovery.mapModel !== undefined &&
    typeof catalog.discovery.mapModel !== 'function'
  ) {
    errors.push('Catalog discovery mapModel must be a function when provided')
  }

  return errors
}

function isCatalogLike(value: unknown): value is ModelCatalogConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'source' in value &&
    typeof (value as { source?: unknown }).source === 'string'
  )
}

function formatAjvErrors(errors: ErrorObject[]): string[] {
  return errors.map(error => {
    const path = error.instancePath || '/'
    const message = error.message ?? 'is invalid'
    if (error.keyword === 'additionalProperties') {
      const property = String(error.params.additionalProperty)
      return `${path} has unsupported property "${property}"`
    }
    return `${path} ${message}`
  })
}

function normalizeReference(value: string): string {
  return value.trim().toLowerCase()
}
