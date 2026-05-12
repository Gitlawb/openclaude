import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { resetStateForTests, setInlinePlugins } from '../../bootstrap/state.js'
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
  isCustomAgent,
  isPluginAgent,
} from './loadAgentsDir.js'
import { loadMarkdownFilesForSubdir } from '../../utils/markdownConfigLoader.js'
import { clearPluginCache } from '../../utils/plugins/pluginLoader.js'

const originalEnv = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_SIMPLE: process.env.CLAUDE_CODE_SIMPLE,
  CLAUDE_CODE_USE_NATIVE_FILE_SEARCH:
    process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH,
}

let tempDir: string
const compoundFixturePath = join(
  process.cwd(),
  'tests/fixtures/plugins/compound-engineering',
)

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'openclaude-agents-test-'))
  process.env.CLAUDE_CONFIG_DIR = join(tempDir, '.openclaude')
  process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = '1'
  delete process.env.CLAUDE_CODE_SIMPLE
  resetStateForTests()
  clearPluginCache('test setup')
  clearAgentDefinitionsCache()
  loadMarkdownFilesForSubdir.cache.clear?.()
})

afterEach(async () => {
  setInlinePlugins([])
  clearPluginCache('test cleanup')
  await rm(tempDir, { recursive: true, force: true })
  restoreEnv('CLAUDE_CONFIG_DIR')
  restoreEnv('CLAUDE_CODE_SIMPLE')
  restoreEnv('CLAUDE_CODE_USE_NATIVE_FILE_SEARCH')
  resetStateForTests()
  clearAgentDefinitionsCache()
  loadMarkdownFilesForSubdir.cache.clear?.()
})

function restoreEnv(key: keyof typeof originalEnv): void {
  const originalValue = originalEnv[key]
  if (originalValue === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = originalValue
  }
}

async function writeAgent(
  filePath: string,
  name: string,
  prompt = `You are ${name}.`,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    `---
name: ${name}
description: "Use for regression coverage"
---

${prompt}
`,
  )
}

describe('agent definition loading', () => {
  test('loads user agents from the OpenClaude config dir in simple mode', async () => {
    await writeAgent(
      join(process.env.CLAUDE_CONFIG_DIR!, 'agents', 'user-agent.md'),
      'user-agent',
    )

    process.env.CLAUDE_CODE_SIMPLE = '1'
    clearAgentDefinitionsCache()
    loadMarkdownFilesForSubdir.cache.clear?.()

    const { activeAgents } = await getAgentDefinitionsWithOverrides(tempDir)

    expect(activeAgents.some(agent => agent.agentType === 'user-agent')).toBe(
      true,
    )
  })

  test('loads project agents from .openclaude/agents', async () => {
    const projectDir = join(tempDir, 'project')
    await writeAgent(
      join(projectDir, '.openclaude', 'agents', 'project-agent.md'),
      'project-agent',
    )

    const { activeAgents } = await getAgentDefinitionsWithOverrides(projectDir)

    expect(
      activeAgents.some(agent => agent.agentType === 'project-agent'),
    ).toBe(true)
  })

  test('prefers .openclaude project agents over legacy .claude agents', async () => {
    const projectDir = join(tempDir, 'project')
    await writeAgent(
      join(projectDir, '.claude', 'agents', 'shared-agent.md'),
      'shared-agent',
      'legacy prompt',
    )
    await writeAgent(
      join(projectDir, '.openclaude', 'agents', 'shared-agent.md'),
      'shared-agent',
      'openclaude prompt',
    )

    const { activeAgents } = await getAgentDefinitionsWithOverrides(projectDir)
    const agent = activeAgents.find(agent => agent.agentType === 'shared-agent')

    expect(agent).toBeDefined()
    if (!agent || !isCustomAgent(agent)) {
      throw new Error('Expected shared-agent to load as a custom agent')
    }

    expect(agent.getSystemPrompt()).toBe('openclaude prompt')
  })

  test('loads Compound-shaped plugin agents without granting per-agent permission escalation fields', async () => {
    setInlinePlugins([compoundFixturePath])
    clearPluginCache('inline plugin changed')
    clearAgentDefinitionsCache()

    const { activeAgents } = await getAgentDefinitionsWithOverrides(tempDir)
    const agent = activeAgents.find(
      agent => agent.agentType === 'compound-engineering:ce-repo-research-analyst',
    )

    expect(agent).toBeDefined()
    if (!agent || !isPluginAgent(agent)) {
      throw new Error('Expected Compound fixture agent to load as a plugin agent')
    }

    expect(agent.source).toBe('plugin')
    expect(agent.plugin).toBe('compound-engineering@inline')
    expect(agent.whenToUse).toBe('Research repository structure and conventions')
    expect(agent.model).toBe('inherit')
    expect(agent.tools).toEqual(['Read', 'Grep'])
    expect(agent.color).toBe('blue')
    expect(agent.getSystemPrompt()).toContain('Research the repository')
    expect(agent && Object.hasOwn(agent, 'permissionMode')).toBe(false)
    expect(agent && Object.hasOwn(agent, 'hooks')).toBe(false)
    expect(agent && Object.hasOwn(agent, 'mcpServers')).toBe(false)
  })
})
