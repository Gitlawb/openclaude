import { describe, expect, test } from 'bun:test'
import { join } from 'path'

import { createPluginFromPath } from './pluginLoader.js'

const compoundFixturePath = join(
  process.cwd(),
  'tests/fixtures/plugins/compound-engineering',
)

describe('createPluginFromPath with Compound-shaped plugins', () => {
  test('loads a metadata-only manifest with default component directories', async () => {
    const { plugin, errors } = await createPluginFromPath(
      compoundFixturePath,
      'compound-engineering@fixture',
      true,
      'compound-engineering',
    )

    expect(errors).toEqual([])
    expect(plugin.name).toBe('compound-engineering')
    expect(plugin.manifest.skills).toBeUndefined()
    expect(plugin.manifest.agents).toBeUndefined()
    expect(plugin.skillsPath).toBe(join(compoundFixturePath, 'skills'))
    expect(plugin.agentsPath).toBe(join(compoundFixturePath, 'agents'))
  })
})
