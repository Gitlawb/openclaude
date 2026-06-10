import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
} from './loadAgentsDir.js'
import { loadMarkdownFilesForSubdir } from '../../utils/markdownConfigLoader.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

const originalEnv = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_SIMPLE: process.env.CLAUDE_CODE_SIMPLE,
  CLAUDE_CODE_USE_NATIVE_FILE_SEARCH:
    process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH,
  USER_TYPE: process.env.USER_TYPE,
}

let tempDir: string

beforeEach(async () => {
  await acquireSharedMutationLock('loadAgentsDir.test.ts')
  tempDir = await mkdtemp(join(tmpdir(), 'openclaude-agents-test-'))
  process.env.CLAUDE_CONFIG_DIR = join(tempDir, '.openclaude')
  process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = '1'
  delete process.env.CLAUDE_CODE_SIMPLE
  clearAgentDefinitionsCache()
  loadMarkdownFilesForSubdir.cache.clear?.()
})

afterEach(async () => {
  try {
    await rm(tempDir, { recursive: true, force: true })
    restoreEnv('CLAUDE_CONFIG_DIR')
    restoreEnv('CLAUDE_CODE_SIMPLE')
    restoreEnv('CLAUDE_CODE_USE_NATIVE_FILE_SEARCH')
    restoreEnv('USER_TYPE')
    clearAgentDefinitionsCache()
    loadMarkdownFilesForSubdir.cache.clear?.()
  } finally {
    releaseSharedMutationLock()
  }
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
  extraFrontmatter = '',
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    `---
name: ${name}
description: "Use for regression coverage"
${extraFrontmatter}
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

    expect(agent?.source === 'projectSettings' ? agent.getSystemPrompt() : undefined).toBe('openclaude prompt')
  })

  test('accepts worktree isolation in markdown agent frontmatter', async () => {
    const projectDir = join(tempDir, 'project')
    await writeAgent(
      join(projectDir, '.openclaude', 'agents', 'worktree-agent.md'),
      'worktree-agent',
      'worktree prompt',
      'isolation: worktree\n',
    )

    const { activeAgents } = await getAgentDefinitionsWithOverrides(projectDir)
    const agent = activeAgents.find(agent => agent.agentType === 'worktree-agent')

    expect(agent?.isolation).toBe('worktree')
  })

  test('rejects removed remote isolation in markdown agent frontmatter', async () => {
    process.env.USER_TYPE = 'ant'
    const projectDir = join(tempDir, 'project')
    await writeAgent(
      join(projectDir, '.openclaude', 'agents', 'remote-agent.md'),
      'remote-agent',
      'remote prompt',
      'isolation: remote\n',
    )

    const { activeAgents } = await getAgentDefinitionsWithOverrides(projectDir)
    const agent = activeAgents.find(agent => agent.agentType === 'remote-agent')

    expect(agent).toBeDefined()
    expect(agent?.isolation).toBeUndefined()
  })
})
