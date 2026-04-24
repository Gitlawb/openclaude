import { describe, expect, it, beforeEach } from 'bun:test'
import { call as knowledgeCall } from './knowledge.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getArc, addEntity, resetArc } from '../../utils/conversationArc.js'

describe('knowledge command', () => {
  const mockContext = {} as any
  
  const knowledgeCallWithCapture = async (args: string) => {
    const result = await knowledgeCall(args, mockContext)
    if (result.type === 'text') {
      return result.value
    }
    return ''
  }

  beforeEach(() => {
    // Reset global config specifically for knowledge graph setting
    saveGlobalConfig(current => ({
      ...current,
      knowledgeGraphEnabled: true
    }))
    resetArc()
  })

  it('enables and disables knowledge graph engine', async () => {
    // Test Disable
    const res1 = await knowledgeCallWithCapture('enable no')
    expect(getGlobalConfig().knowledgeGraphEnabled).toBe(false)
    expect(res1).toContain('disabled')

    // Test Enable
    const res2 = await knowledgeCallWithCapture('enable yes')
    expect(getGlobalConfig().knowledgeGraphEnabled).toBe(true)
    expect(res2).toContain('enabled')
  })

  it('clears the knowledge graph', async () => {
    // Add a fact first
    addEntity('test', 'fact')
    const arc = getArc()
    expect(Object.keys(arc!.knowledgeGraph.entities).length).toBe(1)

    // Clear it
    const res = await knowledgeCallWithCapture('clear')
    expect(Object.keys(getArc()!.knowledgeGraph.entities).length).toBe(0)
    expect(res).toContain('cleared')
  })

  it('shows error on unknown subcommand', async () => {
    const res = await knowledgeCallWithCapture('invalid')
    expect(res).toContain('Unknown subcommand')
  })
})
