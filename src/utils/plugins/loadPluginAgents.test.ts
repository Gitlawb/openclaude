import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { setInlinePlugins } from '../../bootstrap/state.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { clearPluginCache } from './pluginLoader.js'
import { clearPluginAgentCache, loadPluginAgents } from './loadPluginAgents.js'

let tempDir: string

beforeEach(async () => {
  await acquireSharedMutationLock('utils/plugins/loadPluginAgents.test.ts')
  tempDir = await mkdtemp(join(tmpdir(), 'openclaude-plugin-agents-test-'))
  setInlinePlugins([])
  clearPluginCache('loadPluginAgents.test setup')
  clearPluginAgentCache()
})

afterEach(async () => {
  try {
    setInlinePlugins([])
    clearPluginCache('loadPluginAgents.test cleanup')
    clearPluginAgentCache()
    await rm(tempDir, { recursive: true, force: true })
  } finally {
    releaseSharedMutationLock()
  }
})

async function writePluginAgent(
  pluginRoot: string,
  filename: string,
  frontmatter: string,
): Promise<void> {
  await mkdir(join(pluginRoot, '.claude-plugin'), { recursive: true })
  await mkdir(join(pluginRoot, 'agents'), { recursive: true })
  await writeFile(
    join(pluginRoot, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'step-limit-plugin', version: '0.0.0' }),
  )
  await writeFile(
    join(pluginRoot, 'agents', filename),
    `---
name: ${filename.replace(/\.md$/, '')}
description: "Use for plugin maxSteps coverage"
${frontmatter}
---

Plugin agent prompt.
`,
  )
}

describe('loadPluginAgents', () => {
  test('loads valid maxSteps from plugin agent frontmatter and ignores invalid values safely', async () => {
    const pluginRoot = join(tempDir, 'plugin')
    await writePluginAgent(pluginRoot, 'valid.md', 'maxSteps: 7\n')
    await writePluginAgent(pluginRoot, 'invalid.md', 'maxSteps: 0\n')
    await writePluginAgent(pluginRoot, 'malformed.md', 'maxSteps: 2abc\n')

    setInlinePlugins([pluginRoot])
    clearPluginCache('loadPluginAgents.test inline plugin')
    clearPluginAgentCache()

    const agents = await loadPluginAgents()

    const valid = agents.find(
      agent => agent.agentType === 'step-limit-plugin:valid',
    )
    const invalid = agents.find(
      agent => agent.agentType === 'step-limit-plugin:invalid',
    )
    const malformed = agents.find(
      agent => agent.agentType === 'step-limit-plugin:malformed',
    )
    expect(valid?.maxSteps).toBe(7)
    expect(invalid).toBeDefined()
    expect(invalid?.maxSteps).toBeUndefined()
    expect(malformed).toBeDefined()
    expect(malformed?.maxSteps).toBeUndefined()
  })

  test('loads maxSteps from plugin manifest agent file paths', async () => {
    const pluginRoot = join(tempDir, 'manifest-plugin')
    await mkdir(join(pluginRoot, '.claude-plugin'), { recursive: true })
    await mkdir(join(pluginRoot, 'custom-agents'), { recursive: true })
    await writeFile(
      join(pluginRoot, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'manifest-step-limit-plugin',
        version: '0.0.0',
        agents: [
          './custom-agents/valid.md',
          './custom-agents/invalid.md',
          './custom-agents/malformed.md',
        ],
      }),
    )
    for (const [filename, maxSteps] of [
      ['valid.md', '9'],
      ['invalid.md', '0'],
      ['malformed.md', '2abc'],
    ] as const) {
      await writeFile(
        join(pluginRoot, 'custom-agents', filename),
        `---
name: ${filename.replace(/\.md$/, '')}
description: "Use for plugin manifest maxSteps coverage"
maxSteps: ${maxSteps}
---

Plugin manifest agent prompt.
`,
      )
    }

    setInlinePlugins([pluginRoot])
    clearPluginCache('loadPluginAgents.test manifest agents')
    clearPluginAgentCache()

    const agents = await loadPluginAgents()

    const valid = agents.find(
      agent => agent.agentType === 'manifest-step-limit-plugin:valid',
    )
    const invalid = agents.find(
      agent => agent.agentType === 'manifest-step-limit-plugin:invalid',
    )
    const malformed = agents.find(
      agent => agent.agentType === 'manifest-step-limit-plugin:malformed',
    )
    expect(valid?.maxSteps).toBe(9)
    expect(invalid).toBeDefined()
    expect(invalid?.maxSteps).toBeUndefined()
    expect(malformed).toBeDefined()
    expect(malformed?.maxSteps).toBeUndefined()
  })
})
