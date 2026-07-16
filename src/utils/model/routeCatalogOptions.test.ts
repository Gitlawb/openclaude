import { describe, expect, test } from 'bun:test'

import { buildRouteCatalogModelOptions } from './routeCatalogOptions.js'

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

  test('keeps duplicate API models selectable by catalog id and recommends only the selected variant', () => {
    const options = buildRouteCatalogModelOptions('Kimi Code', [
      { id: 'k3', apiName: 'k3', label: 'Kimi K3 (1M)' },
      { id: 'k3-256k', apiName: 'k3', label: 'Kimi K3 (256K)' },
    ], 'k3')

    expect(options.map(option => option.value)).toEqual(['k3', 'k3-256k'])
    expect(options[0]?.description).toContain('Recommended')
    expect(options[1]?.description).not.toContain('Recommended')
  })

  test('surfaces catalog entry notes as a description tag', () => {
    const options = buildRouteCatalogModelOptions('Gitlawb Opengateway', [
      {
        id: 'opengateway-nemotron-3-ultra-free',
        apiName: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        label: 'Nemotron 3 Ultra Free (via Opengateway)',
        notes: 'Free',
      },
    ])

    expect(options[0]?.description).toBe('Free · Provider: Gitlawb Opengateway')
  })
})
