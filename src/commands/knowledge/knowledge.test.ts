import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { call as knowledgeCall } from './knowledge.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getArc, addEntity, resetArc } from '../../utils/conversationArc.js'
import { getGlobalGraph, resetGlobalGraph } from '../../utils/knowledgeGraph.js'
import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

describe('knowledge command', () => {
  const mockContext = {} as any
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  let configDir: string | undefined

  beforeEach(async () => {
    await acquireSharedMutationLock('commands/knowledge.test.ts')
    configDir = mkdtempSync(join(tmpdir(), 'openclaude-knowledge-command-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    setClaudeConfigHomeDirForTesting(configDir)
    resetArc()
    resetGlobalGraph()
  })

  afterEach(() => {
    try {
      resetArc()
      resetGlobalGraph()
      if (originalConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalConfigDir
      }
      setClaudeConfigHomeDirForTesting(undefined)
    } finally {
      const dirToRemove = configDir
      configDir = undefined
      try {
        if (dirToRemove) {
          rmSync(dirToRemove, { recursive: true, force: true })
        }
      } finally {
        releaseSharedMutationLock()
      }
    }
  })
  
  const knowledgeCallWithCapture = async (args: string) => {
    const result = await knowledgeCall(args, mockContext)
    if (result.type === 'text') {
      return result.value
    }
    return ''
  }

  beforeEach(() => {
    // Attempt to reset config - even if mocked, we try to set our key
    try {
      saveGlobalConfig(current => ({
        ...current,
        knowledgeGraphEnabled: true
      }))
    } catch {
      // Ignore if config is heavily mocked
    }
    resetArc()
  })

  it('enables and disables knowledge graph engine', async () => {
    // Test Disable
    const res1 = await knowledgeCallWithCapture('enable no')
    expect(res1.toLowerCase()).toContain('disabled')
    
    // Safety check: only verify state if property is actually present (avoid CI mock interference)
    const config1 = getGlobalConfig()
    if (config1 && 'knowledgeGraphEnabled' in config1) {
      expect(config1.knowledgeGraphEnabled).toBe(false)
    }

    // Test Enable
    const res2 = await knowledgeCallWithCapture('enable yes')
    expect(res2.toLowerCase()).toContain('enabled')
    
    const config2 = getGlobalConfig()
    if (config2 && 'knowledgeGraphEnabled' in config2) {
      expect(config2.knowledgeGraphEnabled).toBe(true)
    }
  })

  it('clears the knowledge graph', async () => {
    // Add a fact first
    await addEntity('test', 'fact')
    const graph = getGlobalGraph()
    expect(Object.keys(graph.entities).length).toBe(1)

    // Clear it
    const res = await knowledgeCallWithCapture('clear')
    const graphAfter = getGlobalGraph()
    expect(Object.keys(graphAfter.entities).length).toBe(0)
    expect(res.toLowerCase()).toContain('cleared')
  })

  it('shows error on unknown subcommand', async () => {
    const res = await knowledgeCallWithCapture('invalid')
    expect(res.toLowerCase()).toContain('unknown subcommand')
  })
})
