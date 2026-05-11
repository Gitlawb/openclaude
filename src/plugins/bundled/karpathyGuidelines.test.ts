import { afterEach, expect, test } from 'bun:test'

import {
  clearBuiltinPlugins,
  getBuiltinPluginDefinition,
} from '../builtinPlugins.js'
import { registerKarpathyGuidelinesPlugin } from './karpathyGuidelines.js'

afterEach(() => {
  clearBuiltinPlugins()
})

test('karpathy guidelines registers as an opt-in built-in plugin', () => {
  registerKarpathyGuidelinesPlugin()

  const plugin = getBuiltinPluginDefinition('karpathy-guidelines')

  expect(plugin).toBeDefined()
  expect(plugin?.defaultEnabled).toBe(false)
  expect(plugin?.skills?.map(skill => skill.name)).toEqual([
    'karpathy-guidelines',
  ])
})

test('karpathy guidelines skill includes optional user focus', async () => {
  registerKarpathyGuidelinesPlugin()

  const skill = getBuiltinPluginDefinition('karpathy-guidelines')?.skills?.[0]
  expect(skill).toBeDefined()

  const blocks = await skill!.getPromptForCommand(
    'prefer tests over snapshots',
    {} as never,
  )
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# CLAUDE.md')
  expect(text).toContain('These guidelines are working if')
  expect(text).toContain('## User Focus')
  expect(text).toContain('prefer tests over snapshots')
})
