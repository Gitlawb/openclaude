import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetStateForTests, setInlinePlugins } from '../../bootstrap/state.js'
import { getCommandName } from '../../types/command.js'
import { clearPluginCache } from './pluginLoader.js'
import { clearPluginSkillsCache, getPluginSkills } from './loadPluginCommands.js'

const originalEnv = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_SIMPLE: process.env.CLAUDE_CODE_SIMPLE,
}

const compoundFixturePath = join(process.cwd(), 'tests/fixtures/plugins/compound-engineering')

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'openclaude-plugin-skills-test-'))
  process.env.CLAUDE_CONFIG_DIR = join(tempDir, '.openclaude')
  delete process.env.CLAUDE_CODE_SIMPLE
  resetStateForTests()
  clearPluginCache('test setup')
  clearPluginSkillsCache()
})

afterEach(async () => {
  setInlinePlugins([])
  clearPluginCache('test cleanup')
  clearPluginSkillsCache()
  await rm(tempDir, { recursive: true, force: true })
  restoreEnv('CLAUDE_CONFIG_DIR')
  restoreEnv('CLAUDE_CODE_SIMPLE')
  resetStateForTests()
})

function restoreEnv(key: keyof typeof originalEnv): void {
  const originalValue = originalEnv[key]
  if (originalValue === undefined) delete process.env[key]
  else process.env[key] = originalValue
}

describe('getPluginSkills', () => {
  test('loads Compound-shaped plugin skills as canonical namespaced commands', async () => {
    setInlinePlugins([compoundFixturePath])
    clearPluginCache('inline plugin changed')
    clearPluginSkillsCache()

    const skills = await getPluginSkills()
    const cePlan = skills.find(
      skill => skill.name === 'compound-engineering:ce-plan',
    )
    const lfg = skills.find(skill => skill.name === 'compound-engineering:lfg')

    expect(cePlan).toBeDefined()
    if (!cePlan || cePlan.type !== 'prompt') {
      throw new Error('Expected ce-plan to load as a prompt command')
    }

    expect(cePlan.source).toBe('plugin')
    expect(cePlan.loadedFrom).toBe('plugin')
    expect(cePlan.aliases).toBeUndefined()
    expect(getCommandName(cePlan)).toBe('compound-engineering:ce-plan')
    expect(cePlan.allowedTools).toEqual(['Read', 'Grep'])
    expect(lfg).toBeDefined()
  })
})
