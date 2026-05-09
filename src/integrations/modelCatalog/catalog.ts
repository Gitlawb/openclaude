import { ensureIntegrationsLoaded } from '../index.js'
import {
  getAnthropicProxy,
  getGateway,
  getModel,
  getVendor,
} from '../registry.js'
import type {
  CapabilityFlags,
  ModelCatalogConfig,
  ModelCatalogEntry,
  ModelDescriptor,
  NormalizedRouteCatalogEntry,
  RouteDescriptor,
  RouteModelRuntimeMetadata,
} from './types.js'

export function getRouteDescriptor(
  routeId: string,
): RouteDescriptor | undefined {
  ensureIntegrationsLoaded()
  return (
    getGateway(routeId) ??
    getVendor(routeId) ??
    getAnthropicProxy(routeId)
  )
}

export function getRouteModelCatalog(
  routeId: string,
): ModelCatalogConfig | undefined {
  return getRouteDescriptor(routeId)?.catalog
}

export function getRouteCatalogEntries(routeId: string): ModelCatalogEntry[] {
  return getRouteModelCatalog(routeId)?.models ?? []
}

export function findRouteCatalogEntry(
  routeId: string,
  modelRef: string,
): ModelCatalogEntry | undefined {
  const normalizedRef = normalizeReference(modelRef)
  if (!normalizedRef) {
    return undefined
  }

  for (const entry of getRouteCatalogEntries(routeId)) {
    if (
      getEntryReferences(routeId, entry).some(
        reference => normalizeReference(reference) === normalizedRef,
      )
    ) {
      return entry
    }
  }

  return undefined
}

export function resolveRouteCatalogEntry(
  routeId: string,
  modelRef: string,
): NormalizedRouteCatalogEntry | undefined {
  const route = getRouteDescriptor(routeId)
  const entry = findRouteCatalogEntry(routeId, modelRef)
  if (!route || !entry) {
    return undefined
  }

  const modelDescriptor = entry.modelDescriptorId
    ? getModel(entry.modelDescriptorId)
    : undefined

  return {
    ...entry,
    capabilities: entry.capabilities ? { ...entry.capabilities } : undefined,
    transportOverrides: entry.transportOverrides
      ? {
          ...entry.transportOverrides,
          openaiShim: entry.transportOverrides.openaiShim
            ? { ...entry.transportOverrides.openaiShim }
            : undefined,
        }
      : undefined,
    routeId,
    routeLabel: route.label,
    modelDescriptor,
  }
}

export function resolveRouteCatalogModelMetadata(
  routeId: string,
  modelRef: string,
): RouteModelRuntimeMetadata | undefined {
  const entry = resolveRouteCatalogEntry(routeId, modelRef)
  if (!entry) {
    return undefined
  }

  const modelDescriptor = entry.modelDescriptor
  const capabilities = mergeCapabilities(
    modelDescriptor?.capabilities,
    entry.capabilities,
  )

  return {
    routeId,
    routeLabel: entry.routeLabel,
    id: entry.id,
    apiName: entry.apiName,
    label: entry.label ?? modelDescriptor?.label ?? entry.id,
    default: entry.default,
    hidden: entry.hidden,
    modelDescriptorId: entry.modelDescriptorId,
    modelDescriptor,
    capabilities,
    contextWindow: entry.contextWindow ?? modelDescriptor?.contextWindow,
    maxOutputTokens: entry.maxOutputTokens ?? modelDescriptor?.maxOutputTokens,
    transportOverrides: entry.transportOverrides,
    notes: entry.notes,
  }
}

function getEntryReferences(
  routeId: string,
  entry: ModelCatalogEntry,
): string[] {
  const references = [
    entry.id,
    entry.apiName,
    entry.modelDescriptorId,
  ].filter((value): value is string => Boolean(value))

  const modelDescriptor = entry.modelDescriptorId
    ? getModel(entry.modelDescriptorId)
    : undefined

  if (modelDescriptor) {
    references.push(
      modelDescriptor.id,
      modelDescriptor.defaultModel,
      ...getRouteSpecificModelNames(routeId, modelDescriptor),
    )
  }

  return Array.from(new Set(references))
}

function getRouteSpecificModelNames(
  routeId: string,
  modelDescriptor: ModelDescriptor,
): string[] {
  const mappedName = modelDescriptor.providerModelMap?.[routeId]
  return mappedName ? [mappedName] : []
}

function mergeCapabilities(
  modelCapabilities?: CapabilityFlags,
  routeCapabilities?: CapabilityFlags,
): CapabilityFlags {
  return {
    ...(modelCapabilities ?? {}),
    ...(routeCapabilities ?? {}),
  }
}

function normalizeReference(value: string): string {
  return value.trim().toLowerCase()
}
