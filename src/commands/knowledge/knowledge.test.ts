import { describe, expect, it, beforeEach } from 'bun:test'
import { call as knowledgeCall } from './knowledge.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getArc, addEntity, resetArc } from '../../utils/conversationArc.js'
import { getGlobalGraph, resetGlobalGraph } from '../../utils/knowledgeGraph.js'

describe('knowledge command', () => {
  const mockContext = {} as any

  beforeEach(async () => {
    resetArc()
    await resetGlobalGraph()
  })
  
  const knowledgeCallWithCapture = async (args: string) => {
    const result = await knowledgeCall(args, mockContext)
    if (result.type === 'text') {
      return result.value
    }
    return ''
  }

  beforeEach(async () => {
    try {
      saveGlobalConfig(current => ({
        ...current,
        knowledgeGraphEnabled: true
      }))
    } catch {
      // Ignore if config is heavily mocked
    }
    resetArc()
    await resetGlobalGraph()
  })

  it('enables and disables knowledge graph engine', async () => {
    const res1 = await knowledgeCallWithCapture('enable no')
    expect(res1.toLowerCase()).toContain('disabled')
    
    const config1 = getGlobalConfig()
    if (config1 && 'knowledgeGraphEnabled' in config1) {
      expect(config1.knowledgeGraphEnabled).toBe(false)
    }

    const res2 = await knowledgeCallWithCapture('enable yes')
    expect(res2.toLowerCase()).toContain('enabled')
    
    const config2 = getGlobalConfig()
    if (config2 && 'knowledgeGraphEnabled' in config2) {
      expect(config2.knowledgeGraphEnabled).toBe(true)
    }
  })

  it('clears the knowledge graph', async () => {
    await addEntity('test', 'fact')
    const graph = await getGlobalGraph()
    expect(Object.keys(graph.entities).length).toBe(1)

    const res = await knowledgeCallWithCapture('clear')
    const graphAfter = await getGlobalGraph()
    expect(Object.keys(graphAfter.entities).length).toBe(0)
    expect(res.toLowerCase()).toContain('cleared')
  })

  it('shows error on unknown subcommand', async () => {
    const res = await knowledgeCallWithCapture('invalid')
    expect(res.toLowerCase()).toContain('unknown subcommand')
  })
})
