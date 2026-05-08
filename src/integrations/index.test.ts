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

  test('route catalogs do not duplicate defaultModel with catalog default flags', () => {
    const routes = [...getAllVendors(), ...getAllGateways()]
    expect(
      routes.flatMap(route =>
        (route.catalog?.models ?? [])
          .filter(model => model.default)
          .map(model => `${route.id}:${model.id}`),
      ),
    ).toEqual([])
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
      'azure-openai:azure-deployment',
    ])
    const missingDescriptors = getAllGateways().flatMap(gateway =>
      (gateway.catalog?.models ?? [])
        .filter(entry => !descriptorOptionalEntries.has(`${gateway.id}:${entry.id}`))
        .filter(entry => !entry.modelDescriptorId)
        .map(entry => `${gateway.id}:${entry.id}`),
    )

    expect(missingDescriptors).toEqual([])
  })

  test('gateway defaultModel values are present in their static catalog', () => {
    const dynamicCatalogRoutes = new Set([
      'atomic-chat',
      'custom',
      'lmstudio',
      'ollama',
    ])
    const missingDefaults = getAllGateways()
      .filter(gateway => gateway.defaultModel)
      .filter(gateway => !dynamicCatalogRoutes.has(gateway.id))
      .filter(gateway => {
        const defaultModel = gateway.defaultModel?.trim()
        return !getCatalogEntriesForRoute(gateway.id).some(
          entry =>
            entry.apiName === defaultModel ||
            entry.modelDescriptorId === defaultModel,
        )
      })
      .map(gateway => `${gateway.id}:${gateway.defaultModel}`)

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
