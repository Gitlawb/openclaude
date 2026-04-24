import { describe, expect, it, beforeEach, spyOn } from 'bun:test'
import { call as knowledgeCall } from './knowledge.js'
import { getGlobalConfig } from '../../utils/config.js'
import { getArc, addEntity } from '../../utils/conversationArc.js'

describe('knowledge command', () => {
  let lastResult: string | undefined
  const onDone = (result?: string) => {
    lastResult = result
  }

  beforeEach(() => {
    // Reset config to a known state
    const config = getGlobalConfig()
    config.knowledgeGraphEnabled = true
  })

  it('enables and disables knowledge graph engine', async () => {
    // Test Disable
    await knowledgeCall(onDone, ['enable', 'no'])
    expect(getGlobalConfig().knowledgeGraphEnabled).toBe(false)
    expect(lastResult).toContain('disabled')

    // Test Enable
    await knowledgeCall(onDone, ['enable', 'yes'])
    expect(getGlobalConfig().knowledgeGraphEnabled).toBe(true)
    expect(lastResult).toContain('enabled')
  })

  it('clears the knowledge graph', async () => {
    // Add a fact first
    addEntity('test', 'fact')
    expect(Object.keys(getArc()!.knowledgeGraph.entities).length).toBe(1)

    // Clear it
    await knowledgeCall(onDone, ['clear'])
    expect(Object.keys(getArc()!.knowledgeGraph.entities).length).toBe(0)
    expect(lastResult).toContain('cleared')
  })

  it('shows error on unknown subcommand', async () => {
    await knowledgeCall(onDone, ['invalid'])
    expect(lastResult).toContain('Unknown subcommand')
  })
})
