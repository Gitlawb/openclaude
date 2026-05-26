import { describe, expect, test } from 'bun:test'

import {
  buildRouteCatalogModelOptions,
  mergeProfileConfiguredModels,
} from './routeCatalogOptions.js'

describe('buildRouteCatalogModelOptions', () => {
  test('marks the route default model as recommended without catalog metadata', () => {
    const options = buildRouteCatalogModelOptions(
      'DeepSeek',
      [
        { id: 'deepseek-chat', apiName: 'deepseek-chat', label: 'DeepSeek Chat' },
        { id: 'deepseek-v4-pro', apiName: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      ],
      'deepseek-v4-pro',
    )

    expect(options).toEqual([
      {
        value: 'deepseek-chat',
        label: 'DeepSeek Chat',
        description: 'Provider: DeepSeek',
        descriptionForModel: 'Provider: DeepSeek (deepseek-chat)',
      },
      {
        value: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        description: 'Recommended · Provider: DeepSeek',
        descriptionForModel: 'Recommended · Provider: DeepSeek (deepseek-v4-pro)',
      },
    ])
  })
})

describe('mergeProfileConfiguredModels', () => {
  const staticMistral = [
    {
      id: 'mistral-vibe-cli',
      apiName: 'mistral-vibe-cli-latest',
      label: 'Mistral Vibe (CLI) Latest',
      modelDescriptorId: 'mistral-vibe-cli-latest',
    },
    {
      id: 'mistral-devstral',
      apiName: 'devstral-latest',
      label: 'Devstral Latest',
      modelDescriptorId: 'devstral-latest',
    },
  ]

  test('passes catalog through unchanged when profile model field is empty or undefined', () => {
    expect(mergeProfileConfiguredModels(staticMistral, undefined)).toBe(staticMistral)
    expect(mergeProfileConfiguredModels(staticMistral, '')).toBe(staticMistral)
    expect(mergeProfileConfiguredModels(staticMistral, '   ;  , ')).toBe(staticMistral)
  })

  test('appends comma/semicolon-separated profile models that the catalog does not know about', () => {
    const merged = mergeProfileConfiguredModels(
      staticMistral,
      'devstral-latest, mistral-medium-latest; codestral-mamba-latest',
    )

    expect(merged.map(entry => entry.apiName)).toEqual([
      'mistral-vibe-cli-latest',
      'devstral-latest',
      'mistral-medium-latest',
      'codestral-mamba-latest',
    ])

    const appended = merged[2]
    expect(appended).toMatchObject({
      apiName: 'mistral-medium-latest',
      label: 'mistral-medium-latest',
      modelDescriptorId: 'mistral-medium-latest',
    })
    expect(appended.id).toContain('mistral-medium-latest')
  })

  test('skips profile models that already exist in the catalog (case-insensitive)', () => {
    const merged = mergeProfileConfiguredModels(
      staticMistral,
      'DEVSTRAL-LATEST, mistral-medium-latest',
    )

    expect(merged).toHaveLength(staticMistral.length + 1)
    expect(merged.map(entry => entry.apiName)).toEqual([
      'mistral-vibe-cli-latest',
      'devstral-latest',
      'mistral-medium-latest',
    ])
  })

  test('passes single-model profile fields through to picker without duplication', () => {
    const merged = mergeProfileConfiguredModels(staticMistral, 'devstral-latest')
    expect(merged).toEqual(staticMistral)
  })

  test('appended profile models flow through buildRouteCatalogModelOptions as picker entries', () => {
    const merged = mergeProfileConfiguredModels(
      staticMistral,
      'devstral-latest, mistral-medium-latest',
    )
    const options = buildRouteCatalogModelOptions(
      'Mistral AI',
      merged,
      'devstral-latest',
    )

    expect(options.map(option => option.value)).toEqual([
      'mistral-vibe-cli-latest',
      'devstral-latest',
      'mistral-medium-latest',
    ])
    const profileOption = options.find(option => option.value === 'mistral-medium-latest')
    expect(profileOption).toMatchObject({
      value: 'mistral-medium-latest',
      label: 'mistral-medium-latest',
      description: 'Provider: Mistral AI',
    })
  })
})
