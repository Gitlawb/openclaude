import { describe, expect, test } from 'bun:test'

import { getActiveSessionAgentModelSelection } from './replActiveAgentModel.js'
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'

function createAgent(model?: string): AgentDefinition {
  return {
    agentType: 'agent',
    whenToUse: 'Use agent',
    source: 'userSettings',
    getSystemPrompt: () => 'You are agent',
    model,
  }
}

describe('getActiveSessionAgentModelSelection', () => {
  test('applies the selected agent model when no explicit model override exists', () => {
    const selection = getActiveSessionAgentModelSelection({
      agent: createAgent('agent-specific-model'),
      baseMainLoopModel: 'sonnet',
      hasExplicitModelOverride: false,
      hasAgentManagedModel: false,
    })

    expect(selection.shouldUpdateModel).toBe(true)
    expect(selection.mainLoopModelForSession).toBe('agent-specific-model')
  })

  test('preserves an explicit model override when selecting an agent with a model', () => {
    const selection = getActiveSessionAgentModelSelection({
      agent: createAgent('agent-specific-model'),
      baseMainLoopModel: 'opus',
      hasExplicitModelOverride: true,
      hasAgentManagedModel: false,
    })

    expect(selection.shouldUpdateModel).toBe(false)
    expect(selection.mainLoopModelForSession).toBeUndefined()
  })

  test('uses the base model when selecting an inheriting agent after an agent-managed model', () => {
    const selection = getActiveSessionAgentModelSelection({
      agent: createAgent('inherit'),
      baseMainLoopModel: 'sonnet',
      hasExplicitModelOverride: false,
      hasAgentManagedModel: true,
    })

    expect(selection.shouldUpdateModel).toBe(true)
    expect(selection.mainLoopModelForSession).toBe('sonnet')
  })

  test('leaves the model untouched for an inheriting agent with no agent-managed model to clear', () => {
    const selection = getActiveSessionAgentModelSelection({
      agent: createAgent('inherit'),
      baseMainLoopModel: 'sonnet',
      hasExplicitModelOverride: false,
      hasAgentManagedModel: false,
    })

    expect(selection.shouldUpdateModel).toBe(false)
    expect(selection.mainLoopModelForSession).toBeUndefined()
  })
})
