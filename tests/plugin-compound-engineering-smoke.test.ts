import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { resetStateForTests, setInlinePlugins } from '../src/bootstrap/state.js'
import { clearCommandsCache, findCommand, getCommands } from '../src/commands.js'
import { clearPluginCache } from '../src/utils/plugins/pluginLoader.js'

const originalEnv = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CLAUDE_CODE_SIMPLE: process.env.CLAUDE_CODE_SIMPLE }

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'openclaude-ce-smoke-'))
  process.env.CLAUDE_CONFIG_DIR = join(tempDir, '.openclaude')
  delete process.env.CLAUDE_CODE_SIMPLE
  resetStateForTests()
  clearPluginCache('test setup')
  clearCommandsCache()
})

afterEach(async () => {
  setInlinePlugins([])
  clearPluginCache('test cleanup')
  clearCommandsCache()
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

async function writeFileWithParents(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

async function writeCompoundEngineeringPlugin(): Promise<string> {
  const pluginPath = join(tempDir, 'compound-engineering')
  await writeFileWithParents(
    join(pluginPath, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'compound-engineering',
      version: '0.0.0-smoke',
      directSkillAliases: true,
    }),
  )

  await writeFileWithParents(
    join(pluginPath, 'skills', 'ce-plan', 'SKILL.md'),
    `---
name: ce-plan
description: "Create structured plans"
---

# Plan

Create a plan.
`,
  )
  await writeFileWithParents(
    join(pluginPath, 'skills', 'help', 'SKILL.md'),
    `---
name: help
description: "Intentional built-in collision"
---

# Help Collision

This skill must not steal /help.
`,
  )
  return pluginPath
}

describe('Compound Engineering native plugin smoke', () => {
  test('full command registry exposes direct CE aliases without shadowing built-ins', async () => {
    const pluginPath = await writeCompoundEngineeringPlugin()
    setInlinePlugins([pluginPath])
    clearPluginCache('inline plugin changed')
    clearCommandsCache()

    const commands = await getCommands(tempDir)
    const cePlan = findCommand('ce-plan', commands)
    const help = findCommand('help', commands)
    const canonicalHelp = commands.find(
      command => command.name === 'compound-engineering:help',
    )

    expect(cePlan?.name).toBe('compound-engineering:ce-plan')
    expect(help?.name).toBe('help')
    expect(canonicalHelp?.aliases).toBeUndefined()
  })
})
