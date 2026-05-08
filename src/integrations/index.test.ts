// src/integrations/index.test.ts
// Integration test: validates the full registry after loading all descriptors.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'
import {
  GATEWAY_DESCRIPTORS,
  VENDOR_DESCRIPTORS,
} from './generated/integrationArtifacts.generated.js'
import {
  getBrandsForVendor,
  getAllGateways,
  getAllVendors,
  getCatalogEntriesForRoute,
  getModel,
  getModelsForVendor,
  routeSupportsApiFormatSelection,
  routeSupportsAuthHeaders,
  routeSupportsCustomHeaders,
  validateIntegrationRegistry,
} from './index.js'
import { getAllProviderCatalogs } from './modelCatalog/catalog.js'
import { getRouteDefaultModel } from './routeMetadata.js'

describe('loaded registry validation', () => {
  test('registry is valid after loading all descriptors', () => {
    const result = validateIntegrationRegistry()
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test('MiniMax has shared brand and model descriptors wired to its route catalog', () => {
    expect(getBrandsForVendor('minimax').map(brand => brand.id)).toContain(
      'minimax',
    )
    expect(getModelsForVendor('minimax').map(model => model.id)).toContain(
      'minimax-m2.7',
    )
    expect(
      getCatalogEntriesForRoute('minimax').every(entry =>
        Boolean(entry.modelDescriptorId),
      ),
    ).toBe(true)
    expect(routeSupportsApiFormatSelection('minimax')).toBe(false)
    expect(routeSupportsAuthHeaders('minimax')).toBe(false)
    expect(routeSupportsCustomHeaders('minimax')).toBe(false)
  })

  test('route defaults live in provider JSON, not route descriptors', () => {
    const routes = [...getAllVendors(), ...getAllGateways()]
    const descriptorDefaults = routes
      .filter(route => 'defaultModel' in route && route.defaultModel !== undefined)
      .map(route => route.id)

    const missingCatalogDefaults = routes
      .filter(route => getRouteDefaultModel(route.id) === undefined)
      .map(route => route.id)

    expect(descriptorDefaults).toEqual([])
    expect(missingCatalogDefaults).toEqual([])
  })

  test('route model catalogs live only in provider JSON files', () => {
    const routes = [...VENDOR_DESCRIPTORS, ...GATEWAY_DESCRIPTORS]
    const inlineModelCatalogRoutes = routes
      .filter(route => route.catalog?.models !== undefined)
      .map(route => route.id)

    expect(inlineModelCatalogRoutes).toEqual([])
  })

  test('every vendor and gateway has a provider JSON catalog', () => {
    const providerCatalogIds = new Set(
      getAllProviderCatalogs().map(catalog => catalog.provider),
    )
    const missingProviderCatalogs = [...VENDOR_DESCRIPTORS, ...GATEWAY_DESCRIPTORS]
      .map(route => route.id)
      .filter(routeId => !providerCatalogIds.has(routeId))

    expect(missingProviderCatalogs).toEqual([])
  })

  test('shared model and brand descriptors do not duplicate model catalog facts', () => {
    const integrationsDir = path.join(import.meta.dir)
    const descriptorFiles = [
      ...readdirSync(path.join(integrationsDir, 'models')).map(fileName =>
        path.join(integrationsDir, 'models', fileName),
      ),
      ...readdirSync(path.join(integrationsDir, 'brands')).map(fileName =>
        path.join(integrationsDir, 'brands', fileName),
      ),
    ].filter(fileName => fileName.endsWith('.ts') && !fileName.endsWith('.test.ts'))

    const duplicatedFacts = descriptorFiles.flatMap(fileName => {
      const source = readFileSync(fileName, 'utf8')
      const forbiddenPatterns = [
        /contextWindow\s*:/,
        /maxOutputTokens\s*:/,
        /modelIds\s*:/,
      ]
      return forbiddenPatterns.some(pattern => pattern.test(source))
        ? [path.relative(integrationsDir, fileName)]
        : []
    })

    expect(duplicatedFacts).toEqual([])
  })

  test('static gateway catalog entries use shared model descriptors when known', () => {
    const descriptorOptionalEntries = new Set([
      'atomic-chat:local-model',
      'azure-openai:azure-deployment',
      'custom:local-model',
      'lmstudio:local-model',
    ])
    const missingDescriptors = getAllGateways().flatMap(gateway =>
      getCatalogEntriesForRoute(gateway.id)
        .filter(entry => !descriptorOptionalEntries.has(`${gateway.id}:${entry.id}`))
        .filter(entry => !entry.modelDescriptorId)
        .map(entry => `${gateway.id}:${entry.id}`),
    )

    expect(missingDescriptors).toEqual([])
  })

  test('route default models resolve from a catalog default entry', () => {
    const missingDefaults = [...getAllVendors(), ...getAllGateways()]
      .filter(route => {
        const defaultModel = getRouteDefaultModel(route.id)
        return !defaultModel || !getCatalogEntriesForRoute(route.id).some(
          entry => entry.default && entry.apiName === defaultModel,
        )
      })
      .map(route => `${route.id}:${getRouteDefaultModel(route.id) ?? '<none>'}`)

    expect(missingDefaults).toEqual([])
  })

  test('gateway modelDescriptorId references have model metadata', () => {
    const missingModels = getAllGateways().flatMap(gateway =>
      getCatalogEntriesForRoute(gateway.id)
        .filter(entry => entry.modelDescriptorId)
        .filter(entry => !getModel(entry.modelDescriptorId!))
        .map(entry => `${gateway.id}:${entry.id}:${entry.modelDescriptorId}`),
    )

    expect(missingModels).toEqual([])
  })
})
