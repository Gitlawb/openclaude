import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { setAllowedSettingSources } from '../../bootstrap/state.js'
import {
  getClaudeConfigHomeDir,
  getClaudeConfigHomeDirOverrideForTesting,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
  parseAgentFromJson,
} from './loadAgentsDir.js'
import { loadMarkdownFilesForSubdir } from '../../utils/markdownConfigLoader.js'
import { SETTING_SOURCES } from '../../utils/settings/constants.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

const originalEnv = {
  HOME: process.env.HOME,
  OPENCLAUDE_CONFIG_DIR: process.env.OPENCLAUDE_CONFIG_DIR,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_SIMPLE: process.env.CLAUDE_CODE_SIMPLE,
  CLAUDE_CODE_USE_NATIVE_FILE_SEARCH:
    process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH,
  USER_TYPE: process.env.USER_TYPE,
}

let tempDir: string
let projectRootDir: string
let userConfigDir: string
let previousConfigHomeOverride: string | undefined

beforeEach(async () => {
  await acquireSharedMutationLock('loadAgentsDir.test.ts')
  tempDir = await mkdtemp(join(tmpdir(), 'openclaude-agents-test-'))
  projectRootDir = await mkdtemp(join(tmpdir(), 'openclaude-agents-project-'))
  const configDir = join(tempDir, '.openclaude')
  previousConfigHomeOverride = getClaudeConfigHomeDirOverrideForTesting()
  setClaudeConfigHomeDirForTesting(configDir)
  process.env.HOME = tempDir
  process.env.OPENCLAUDE_CONFIG_DIR = configDir
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = '1'
  delete process.env.CLAUDE_CODE_SIMPLE
  setAllowedSettingSources([...SETTING_SOURCES])
  getClaudeConfigHomeDir.cache?.clear?.()
  const resolvedConfigDir = getClaudeConfigHomeDir()
  userConfigDir = resolvedConfigDir.startsWith(join(tmpdir(), ''))
    ? resolvedConfigDir
    : configDir
  resetSettingsCache()
  clearAgentDefinitionsCache()
  loadMarkdownFilesForSubdir.cache.clear?.()
})

afterEach(async () => {
  try {
    await rm(join(userConfigDir, 'agents', 'user-agent.md'), { force: true })
    await rm(join(userConfigDir, 'agents', 'shared-limited.md'), {
      force: true,
    })
    await rm(tempDir, { recursive: true, force: true })
    await rm(projectRootDir, { recursive: true, force: true })
    restoreEnv('HOME')
    restoreEnv('OPENCLAUDE_CONFIG_DIR')
    restoreEnv('CLAUDE_CONFIG_DIR')
    restoreEnv('CLAUDE_CODE_SIMPLE')
    restoreEnv('CLAUDE_CODE_USE_NATIVE_FILE_SEARCH')
    restoreEnv('USER_TYPE')
    setAllowedSettingSources([...SETTING_SOURCES])
    setClaudeConfigHomeDirForTesting(previousConfigHomeOverride)
    previousConfigHomeOverride = undefined
    getClaudeConfigHomeDir.cache?.clear?.()
    resetSettingsCache()
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
      join(userConfigDir, 'agents', 'user-agent.md'),
      'user-agent',
    )

    process.env.CLAUDE_CODE_SIMPLE = '1'
    clearAgentDefinitionsCache()
    loadMarkdownFilesForSubdir.cache.clear?.()

    const { activeAgents } = await getAgentDefinitionsWithOverrides(
      projectRootDir,
    )

    expect(activeAgents.some(agent => agent.agentType === 'user-agent')).toBe(
      true,
    )
  })

  test('loads project agents from .openclaude/agents', async () => {
    const projectDir = join(projectRootDir, 'project')
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
    const projectDir = join(projectRootDir, 'project')
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
    const projectDir = join(projectRootDir, 'project')
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
    const projectDir = join(projectRootDir, 'project')
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

  test('loads maxSteps from markdown agent frontmatter', async () => {
    const projectDir = join(projectRootDir, 'project')
    await writeAgent(
      join(projectDir, '.openclaude', 'agents', 'limited-agent.md'),
      'limited-agent',
      'limited prompt',
      'maxSteps: 3\n',
    )

    const { activeAgents } = await getAgentDefinitionsWithOverrides(projectDir)
    const agent = activeAgents.find(agent => agent.agentType === 'limited-agent')

    expect(agent?.maxSteps).toBe(3)
  })

  test('ignores invalid maxSteps in markdown agent frontmatter', async () => {
    const projectDir = join(projectRootDir, 'project')
    await writeAgent(
      join(projectDir, '.openclaude', 'agents', 'invalid-steps-agent.md'),
      'invalid-steps-agent',
      'invalid steps prompt',
      'maxSteps: 0\n',
    )
    await writeAgent(
      join(projectDir, '.openclaude', 'agents', 'malformed-steps-agent.md'),
      'malformed-steps-agent',
      'malformed steps prompt',
      'maxSteps: 2abc\n',
    )

    const { activeAgents } = await getAgentDefinitionsWithOverrides(projectDir)
    const agent = activeAgents.find(
      agent => agent.agentType === 'invalid-steps-agent',
    )
    const malformed = activeAgents.find(
      agent => agent.agentType === 'malformed-steps-agent',
    )

    expect(agent).toBeDefined()
    expect(agent?.maxSteps).toBeUndefined()
    expect(malformed).toBeDefined()
    expect(malformed?.maxSteps).toBeUndefined()
  })

  test('project agent maxSteps overrides user agent maxSteps for the same name', async () => {
    const projectDir = join(projectRootDir, 'project')
    await writeAgent(
      join(userConfigDir, 'agents', 'shared-limited.md'),
      'shared-limited',
      'user prompt',
      'maxSteps: 1\n',
    )
    await writeAgent(
      join(projectDir, '.openclaude', 'agents', 'shared-limited.md'),
      'shared-limited',
      'project prompt',
      'maxSteps: 5\n',
    )

    const { activeAgents } = await getAgentDefinitionsWithOverrides(projectDir)
    const agent = activeAgents.find(agent => agent.agentType === 'shared-limited')

    expect(agent?.source).toBe('projectSettings')
    expect(agent?.maxSteps).toBe(5)
  })

  test('loads maxSteps from JSON agent definitions and rejects invalid values safely', () => {
    const valid = parseAgentFromJson('json-limited', {
      description: 'Use for JSON maxSteps coverage',
      prompt: 'JSON prompt',
      maxSteps: 2,
    })
    const invalid = parseAgentFromJson('json-invalid', {
      description: 'Use for invalid JSON maxSteps coverage',
      prompt: 'JSON prompt',
      maxSteps: 0,
    })

    expect(valid?.maxSteps).toBe(2)
    expect(invalid).toBeNull()
  })
})
