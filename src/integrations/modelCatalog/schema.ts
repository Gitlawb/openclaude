import Ajv2020 from 'ajv/dist/2020.js'
import schema from './schema.json'
import type { ModelCatalogTemplate, ProviderCatalog } from './types.js'

export type CatalogValidationResult = {
  valid: boolean
  errors: string[]
}

const ajv = new Ajv2020({ allErrors: true })
const validate = ajv.compile(schema)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateOutputLimit(
  path: string,
  limits: unknown,
  errors: string[],
): void {
  if (!isRecord(limits)) {
    return
  }

  const output = limits.maxOutputTokens
  if (!isRecord(output)) {
    return
  }

  const defaultValue = output.default
  const upperLimit = output.upperLimit
  if (
    typeof defaultValue === 'number' &&
    typeof upperLimit === 'number' &&
    defaultValue > upperLimit
  ) {
    errors.push(`${path}.maxOutputTokens.default must be <= upperLimit`)
  }
}

function resolveTemplateEndpoint(
  templateId: string,
  templates: Record<string, ModelCatalogTemplate>,
  stack: string[] = [],
): string | undefined {
  if (stack.includes(templateId)) {
    return undefined
  }

  const template = templates[templateId]
  if (!template) {
    return undefined
  }

  let endpoint: string | undefined
  const extendedTemplateIds = Array.isArray(template.extends)
    ? template.extends
    : []
  for (const extendedTemplateId of extendedTemplateIds) {
    if (typeof extendedTemplateId !== 'string') {
      continue
    }

    endpoint =
      resolveTemplateEndpoint(extendedTemplateId, templates, [
        ...stack,
        templateId,
      ]) ?? endpoint
  }

  return typeof template.endpoint === 'string' ? template.endpoint : endpoint
}

function resolveModelEndpoint(
  model: ProviderCatalog['models'][string],
  catalog: ProviderCatalog,
): string | undefined {
  if (model.endpoint) {
    return model.endpoint
  }

  let endpoint: string | undefined
  const templates = catalog.templates ?? {}
  for (const templateId of model.extends ?? []) {
    endpoint = resolveTemplateEndpoint(templateId, templates) ?? endpoint
  }

  return endpoint ?? catalog.defaults?.endpoint
}

function addModelReference(
  referenceOwners: Map<string, string>,
  owner: string,
  value: string | undefined,
  errors: string[],
): void {
  if (value === undefined) {
    return
  }

  const normalizedValue = value.trim().toLowerCase()
  const existingOwner = referenceOwners.get(normalizedValue)
  if (existingOwner !== undefined) {
    if (existingOwner !== owner) {
      errors.push(
        `model reference "${value}" is used by both "${existingOwner}" and "${owner}"`,
      )
    }
    return
  }

  referenceOwners.set(normalizedValue, owner)
}

export function validateProviderCatalog(
  catalog: unknown,
): CatalogValidationResult {
  const errors: string[] = []

  if (!validate(catalog)) {
    for (const error of validate.errors ?? []) {
      const path = error.instancePath || '/'
      errors.push(`${path} ${error.message ?? 'is invalid'}`)
    }
    return { valid: false, errors }
  }

  const typed = catalog as ProviderCatalog
  const endpointIds = new Set(Object.keys(typed.endpoints))
  const templateIds = new Set(Object.keys(typed.templates ?? {}))

  if (typed.defaults?.endpoint && !endpointIds.has(typed.defaults.endpoint)) {
    errors.push(
      `defaults.endpoint references missing endpoint "${typed.defaults.endpoint}"`,
    )
  }

  validateOutputLimit('defaults.limits', typed.defaults?.limits, errors)

  if (typed.discovery && !endpointIds.has(typed.discovery.endpoint)) {
    errors.push(`discovery references missing endpoint "${typed.discovery.endpoint}"`)
  }

  for (const [templateId, template] of Object.entries(typed.templates ?? {})) {
    if (
      typeof template.endpoint === 'string' &&
      !endpointIds.has(template.endpoint)
    ) {
      errors.push(
        `template "${templateId}" references missing endpoint "${template.endpoint}"`,
      )
    }
    if (
      typeof template.fallbackEndpoint === 'string' &&
      !endpointIds.has(template.fallbackEndpoint)
    ) {
      errors.push(
        `template "${templateId}" references missing fallback endpoint "${template.fallbackEndpoint}"`,
      )
    }
    if (Array.isArray(template.extends)) {
      for (const extendedTemplateId of template.extends) {
        if (
          typeof extendedTemplateId === 'string' &&
          !templateIds.has(extendedTemplateId)
        ) {
          errors.push(
            `template "${templateId}" references missing template "${extendedTemplateId}"`,
          )
        }
      }
    }
    validateOutputLimit(`template "${templateId}".limits`, template.limits, errors)
  }

  const aliases = new Map<string, string>()
  const referenceOwners = new Map<string, string>()
  for (const [modelId, model] of Object.entries(typed.models)) {
    addModelReference(referenceOwners, modelId, modelId, errors)
    addModelReference(referenceOwners, modelId, model.apiName, errors)
    addModelReference(referenceOwners, modelId, model.canonicalModelId, errors)

    const endpoint = resolveModelEndpoint(model, typed)
    if (!endpoint) {
      errors.push(
        `model "${modelId}" must define an endpoint or inherit one from templates/defaults`,
      )
    } else if (!endpointIds.has(endpoint)) {
      errors.push(`model "${modelId}" references missing endpoint "${endpoint}"`)
    }
    if (model.fallbackEndpoint && !endpointIds.has(model.fallbackEndpoint)) {
      errors.push(
        `model "${modelId}" references missing fallback endpoint "${model.fallbackEndpoint}"`,
      )
    }
    for (const templateId of model.extends ?? []) {
      if (!templateIds.has(templateId)) {
        errors.push(`model "${modelId}" references missing template "${templateId}"`)
      }
    }
    validateOutputLimit(`model "${modelId}".limits`, model.limits, errors)
    const modelAliases = new Set<string>()
    for (const alias of model.aliases ?? []) {
      const normalizedAlias = alias.trim().toLowerCase()
      if (modelAliases.has(normalizedAlias)) {
        errors.push(`alias "${alias}" is duplicated within model "${modelId}"`)
      }
      modelAliases.add(normalizedAlias)
      const owner = aliases.get(normalizedAlias)
      if (owner && owner !== modelId) {
        errors.push(`alias "${alias}" is used by both "${owner}" and "${modelId}"`)
      }
      aliases.set(normalizedAlias, modelId)
      addModelReference(referenceOwners, modelId, alias, errors)
    }
    for (const legacyId of model.compatibility?.legacyIds ?? []) {
      addModelReference(referenceOwners, modelId, legacyId, errors)
    }
    for (const migrationAlias of model.compatibility?.migrationAliases ?? []) {
      addModelReference(referenceOwners, modelId, migrationAlias, errors)
    }
  }

  return { valid: errors.length === 0, errors }
}
