import { afterEach, beforeEach, expect, test } from 'bun:test'
import { AGENT_TOOL_NAME } from '../tools/AgentTool/constants.js'
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import type { Message } from '../types/message.js'
import type { ToolUseContext } from '../Tool.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { formatAgentLine } from '../tools/AgentTool/prompt.js'
import {
  getAgentListingDeltaAttachment,
  resetSentSkillNames,
  suppressNextAgentListing,
} from './attachments.js'
import {
  prepareInReplResumeListingState,
  restoreSkillStateFromMessages,
} from './conversationRecovery.js'

const originalAgentListEnv = process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES

beforeEach(async () => {
  await acquireSharedMutationLock('attachments.agentListingResume')
  process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES = '1'
  resetSentSkillNames()
})

afterEach(async () => {
  resetSentSkillNames()
  if (originalAgentListEnv === undefined) {
    delete process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES
  } else {
    process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES = originalAgentListEnv
  }
  releaseSharedMutationLock()
})

function agent(agentType: string, whenToUse = `${agentType} work`): AgentDefinition {
  return {
    agentType,
    whenToUse,
    source: 'built-in',
    baseDir: 'built-in',
    getSystemPrompt: () => '',
  }
}

function toolUseContext(activeAgents: AgentDefinition[]): ToolUseContext {
  return {
    options: {
      tools: [{ name: AGENT_TOOL_NAME }],
      agentDefinitions: {
        activeAgents,
        allAgents: activeAgents,
      },
    },
    getAppState: () => ({
      toolPermissionContext: {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      },
    }),
  } as unknown as ToolUseContext
}

function listingDeltaMessage(
  agents: AgentDefinition[],
  removedTypes: string[] = [],
  isInitial = true,
): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000a001',
    attachment: {
      type: 'agent_listing_delta',
      addedTypes: agents.map(a => a.agentType),
      addedLines: agents.map(formatAgentLine),
      removedTypes,
      isInitial,
      showConcurrencyNote: true,
    },
  } as unknown as Message
}

test('suppressNextAgentListing skips duplicate listing once when agent set is unchanged', () => {
  const agents = [agent('Explore'), agent('Plan')]
  const messages = [listingDeltaMessage([agent('Explore'), agent('Plan')])]
  const ctx = toolUseContext(agents)

  suppressNextAgentListing()
  expect(getAgentListingDeltaAttachment(ctx, messages)).toEqual([])

  // Latch is one-shot — second pass with unchanged set still yields [] via
  // normal announced reconstruction, not via the latch.
  expect(getAgentListingDeltaAttachment(ctx, messages)).toEqual([])

  // Empty transcript would re-announce if the latch were still armed.
  const afterLatch = getAgentListingDeltaAttachment(ctx, [])
  expect(afterLatch).toHaveLength(1)
  expect(afterLatch[0]).toMatchObject({
    type: 'agent_listing_delta',
    addedTypes: ['Explore', 'Plan'],
    isInitial: true,
  })
})

test('suppressNextAgentListing still emits delta when agent set changed across resume', () => {
  const messages = [listingDeltaMessage([agent('Explore')])]
  const ctx = toolUseContext([agent('Plan')])

  suppressNextAgentListing()
  const delta = getAgentListingDeltaAttachment(ctx, messages)
  expect(delta).toHaveLength(1)
  expect(delta[0]).toMatchObject({
    type: 'agent_listing_delta',
    addedTypes: ['Plan'],
    removedTypes: ['Explore'],
    isInitial: false,
  })

  // Latch was consumed on the changed-set path too.
  const afterLatch = getAgentListingDeltaAttachment(ctx, [])
  expect(afterLatch).toHaveLength(1)
  expect(afterLatch[0]).toMatchObject({
    type: 'agent_listing_delta',
    addedTypes: ['Plan'],
    isInitial: true,
  })
})

test('resetSentSkillNames clears the agent-listing suppress latch', () => {
  const agents = [agent('Explore')]
  const ctx = toolUseContext(agents)

  suppressNextAgentListing()
  resetSentSkillNames()

  const delta = getAgentListingDeltaAttachment(ctx, [])
  expect(delta).toHaveLength(1)
  expect(delta[0]).toMatchObject({
    type: 'agent_listing_delta',
    addedTypes: ['Explore'],
    isInitial: true,
  })
})

test('restoreSkillStateFromMessages arms agent suppress and skips duplicate on resume pass', () => {
  const agents = [agent('Explore'), agent('Plan')]
  const messages = [listingDeltaMessage([agent('Explore'), agent('Plan')])]
  const ctx = toolUseContext(agents)

  restoreSkillStateFromMessages(messages)
  expect(getAgentListingDeltaAttachment(ctx, messages)).toEqual([])
})

test('restoreSkillStateFromMessages still allows agent delta when available set changed', () => {
  const messages = [listingDeltaMessage([agent('Explore')])]
  const ctx = toolUseContext([agent('Explore'), agent('Plan')])

  restoreSkillStateFromMessages(messages)
  const delta = getAgentListingDeltaAttachment(ctx, messages)
  expect(delta).toHaveLength(1)
  expect(delta[0]).toMatchObject({
    type: 'agent_listing_delta',
    addedTypes: ['Plan'],
    removedTypes: [],
    isInitial: false,
  })
})


test('suppressNextAgentListing re-announces when same-type whenToUse changed across resume', () => {
  const oldAgents = [agent('Explore', 'Old explore description')]
  const messages = [listingDeltaMessage(oldAgents)]
  const ctx = toolUseContext([agent('Explore', 'New explore description')])

  suppressNextAgentListing()
  const delta = getAgentListingDeltaAttachment(ctx, messages)
  expect(delta).toHaveLength(1)
  expect(delta[0]).toMatchObject({
    type: 'agent_listing_delta',
    addedTypes: ['Explore'],
    removedTypes: [],
    isInitial: false,
  })
  expect((delta[0] as { addedLines: string[] }).addedLines[0]).toContain(
    'New explore description',
  )
})

test('getAgentListingDeltaAttachment re-announces when same-type tool policy changed', () => {
  const oldAgent = {
    ...agent('Explore', 'Explore work'),
    tools: ['Read'],
  }
  const messages = [listingDeltaMessage([oldAgent])]
  const newAgent = {
    ...agent('Explore', 'Explore work'),
    tools: ['Read', 'Bash'],
  }
  const ctx = toolUseContext([newAgent])

  const delta = getAgentListingDeltaAttachment(ctx, messages)
  expect(delta).toHaveLength(1)
  expect(delta[0]).toMatchObject({
    type: 'agent_listing_delta',
    addedTypes: ['Explore'],
    removedTypes: [],
  })
  expect((delta[0] as { addedLines: string[] }).addedLines[0]).toContain('Bash')
})

test('suppressNextAgentListing still skips when same-type content matches transcript', () => {
  const agents = [agent('Explore', 'Explore work')]
  const messages = [listingDeltaMessage(agents)]
  const ctx = toolUseContext(agents)

  suppressNextAgentListing()
  expect(getAgentListingDeltaAttachment(ctx, messages)).toEqual([])
})

test('suppressNextAgentListing uses recovered announced set when messages lack listing', () => {
  const agents = [agent('Explore'), agent('Plan')]
  const recovered = new Map(
    agents.map(a => [a.agentType, formatAgentLine(a)] as const),
  )
  const ctx = toolUseContext(agents)

  suppressNextAgentListing(recovered)
  // First attachment pass with unhydrated messages=[] must not re-announce.
  expect(getAgentListingDeltaAttachment(ctx, [])).toEqual([])
})

test('suppressNextAgentListing emits corrective delta from recovered set when messages lack listing', () => {
  const recovered = new Map([['Explore', formatAgentLine(agent('Explore'))]])
  const ctx = toolUseContext([agent('Plan')])

  suppressNextAgentListing(recovered)
  const delta = getAgentListingDeltaAttachment(ctx, [])
  expect(delta).toHaveLength(1)
  expect(delta[0]).toMatchObject({
    type: 'agent_listing_delta',
    addedTypes: ['Plan'],
    removedTypes: ['Explore'],
    isInitial: false,
  })
})

test('restoreSkillStateFromMessages retains recovered set for unhydrated first pass', () => {
  const agents = [agent('Explore'), agent('Plan')]
  const messages = [listingDeltaMessage(agents)]
  const ctx = toolUseContext(agents)

  restoreSkillStateFromMessages(messages)
  expect(getAgentListingDeltaAttachment(ctx, [])).toEqual([])
})

test('restoreSkillStateFromMessages ignores partial agent_listing_delta before arming suppress', () => {
  const agents = [agent('Explore'), agent('Plan')]
  const partial = {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000a0bad',
    attachment: {
      type: 'agent_listing_delta',
      addedTypes: agents.map(a => a.agentType),
      // missing addedLines / removedTypes — must not arm suppression
    },
  } as unknown as Message
  const ctx = toolUseContext(agents)

  restoreSkillStateFromMessages([partial])
  // Latch was not armed, so the normal initial listing is still emitted.
  const delta = getAgentListingDeltaAttachment(ctx, [])
  expect(delta).toHaveLength(1)
  expect(delta[0]?.type).toBe('agent_listing_delta')
  if (delta[0]?.type === 'agent_listing_delta') {
    expect(delta[0].isInitial).toBe(true)
    expect(delta[0].addedTypes).toEqual(['Explore', 'Plan'])
  }
})

test('restoreSkillStateFromMessages ignores mismatched-length agent_listing_delta', () => {
  const explore = agent('Explore')
  const prior = listingDeltaMessage([explore])
  const mismatched = {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000a0misr',
    attachment: {
      type: 'agent_listing_delta',
      addedTypes: ['Explore'],
      addedLines: [],
      removedTypes: ['Explore'],
    },
  } as unknown as Message
  const ctx = toolUseContext([explore])

  restoreSkillStateFromMessages([prior, mismatched])
  // Fail closed: mismatched record must not strip Explore from the recovered map.
  expect(getAgentListingDeltaAttachment(ctx, [])).toEqual([])
})

test('prepareInReplResumeListingState clears prior suppress latch before restore', () => {
  const agents = [agent('Explore')]
  const ctx = toolUseContext(agents)

  // Simulate prior in-process session latch still armed.
  suppressNextAgentListing()
  prepareInReplResumeListingState([])

  const delta = getAgentListingDeltaAttachment(ctx, [])
  expect(delta).toHaveLength(1)
  expect(delta[0]).toMatchObject({
    type: 'agent_listing_delta',
    addedTypes: ['Explore'],
    isInitial: true,
  })
})

test('prepareInReplResumeListingState restores transcript listing after clear', () => {
  const agents = [agent('Explore'), agent('Plan')]
  const messages = [listingDeltaMessage(agents)]
  const ctx = toolUseContext(agents)

  suppressNextAgentListing()
  prepareInReplResumeListingState(messages)
  // Transcript restore re-arms suppress against the hydrated messages.
  expect(getAgentListingDeltaAttachment(ctx, messages)).toEqual([])
})

test('getAgentListingDeltaAttachment ignores mismatched addedTypes/addedLines lengths', () => {
  // Malformed record must not delete Explore without a replacement line.
  const explore = agent('Explore')
  const prior = listingDeltaMessage([explore])
  const mismatched = {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000a0mis',
    attachment: {
      type: 'agent_listing_delta',
      addedTypes: ['Explore'],
      addedLines: [], // length mismatch vs addedTypes
      removedTypes: ['Explore'],
    },
  } as unknown as Message
  const ctx = toolUseContext([explore])

  const delta = getAgentListingDeltaAttachment(ctx, [prior, mismatched])
  // Prior announcement still stands; no corrective delta.
  expect(delta).toEqual([])
})

test('getAgentListingDeltaAttachment ignores non-string agent delta entries', () => {
  const explore = agent('Explore')
  const prior = listingDeltaMessage([explore])
  const badEntries = {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000a0ns',
    attachment: {
      type: 'agent_listing_delta',
      addedTypes: ['Explore'],
      addedLines: [null],
      removedTypes: ['Explore'],
    },
  } as unknown as Message
  const ctx = toolUseContext([explore])

  const delta = getAgentListingDeltaAttachment(ctx, [prior, badEntries])
  expect(delta).toEqual([])
})

test('holds MCP-gated agent removals while MCP tool pool is still empty', () => {
  // Resume race: transcript announced McpAgent, but tools have no MCP names yet.
  const mcpAgent: AgentDefinition = {
    ...agent('McpAgent'),
    requiredMcpServers: ['docs'],
  }
  const messages = [listingDeltaMessage([mcpAgent])]
  const ctx = toolUseContext([mcpAgent])

  const delta = getAgentListingDeltaAttachment(ctx, messages)
  expect(delta).toEqual([])
})

test('holds MCP-gated agent removals while required server is still pending', () => {
  // Mixed state: other MCP tools are in the pool, but docs is still pending.
  // An unrelated connected client must not authorize removal of a docs-gated agent.
  const mcpAgent: AgentDefinition = {
    ...agent('McpAgent'),
    requiredMcpServers: ['docs'],
  }
  const messages = [listingDeltaMessage([mcpAgent])]
  const ctx = {
    options: {
      tools: [{ name: AGENT_TOOL_NAME }, { name: 'mcp__other__tool' }],
      mcpClients: [
        {
          type: 'connected',
          name: 'other',
          instructions: 'Still here.',
          client: {} as never,
          capabilities: {},
          config: {} as never,
          cleanup: async () => {},
        },
        {
          type: 'pending',
          name: 'docs',
          config: {} as never,
        },
      ],
      agentDefinitions: {
        activeAgents: [mcpAgent],
        allAgents: [mcpAgent],
      },
    },
    getAppState: () => ({
      toolPermissionContext: {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      },
    }),
  } as unknown as ToolUseContext

  const delta = getAgentListingDeltaAttachment(ctx, messages)
  expect(delta).toEqual([])
})

test('holds MCP-gated agent removals while required server needs-auth (jatmn [P3])', () => {
  const mcpAgent: AgentDefinition = {
    ...agent('McpAgent'),
    requiredMcpServers: ['docs'],
  }
  const messages = [listingDeltaMessage([mcpAgent])]
  const ctx = {
    options: {
      tools: [{ name: AGENT_TOOL_NAME }, { name: 'mcp__other__tool' }],
      mcpClients: [
        {
          type: 'connected',
          name: 'other',
          instructions: 'Still here.',
          client: {} as never,
          capabilities: {},
          config: {} as never,
          cleanup: async () => {},
        },
        {
          type: 'needs-auth',
          name: 'docs',
          config: {} as never,
        },
      ],
      agentDefinitions: {
        activeAgents: [mcpAgent],
        allAgents: [mcpAgent],
      },
    },
    getAppState: () => ({
      toolPermissionContext: {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      },
    }),
  } as unknown as ToolUseContext

  const delta = getAgentListingDeltaAttachment(ctx, messages)
  expect(delta).toEqual([])
})

test('emits MCP-gated agent removal once MCP tools are in the pool', () => {
  const mcpAgent: AgentDefinition = {
    ...agent('McpAgent'),
    requiredMcpServers: ['docs'],
  }
  const messages = [listingDeltaMessage([mcpAgent])]
  // MCP tool present → pool settled; agent still fails requirements → remove.
  // No pending client can satisfy docs.
  const ctx = {
    options: {
      tools: [{ name: AGENT_TOOL_NAME }, { name: 'mcp__other__tool' }],
      mcpClients: [
        {
          type: 'connected',
          name: 'other',
          instructions: 'Still here.',
          client: {} as never,
          capabilities: {},
          config: {} as never,
          cleanup: async () => {},
        },
      ],
      agentDefinitions: {
        activeAgents: [mcpAgent],
        allAgents: [mcpAgent],
      },
    },
    getAppState: () => ({
      toolPermissionContext: {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      },
    }),
  } as unknown as ToolUseContext

  const delta = getAgentListingDeltaAttachment(ctx, messages)
  expect(delta).toHaveLength(1)
  if (delta[0]?.type === 'agent_listing_delta') {
    expect(delta[0].removedTypes).toEqual(['McpAgent'])
    expect(delta[0].addedTypes).toEqual([])
  }
})

test('in-REPL resume contract: restoreSkillStateFromMessages after deserialize arms suppress', () => {
  // screens/REPL.tsx resume() must call restoreSkillStateFromMessages(messages)
  // after deserializeMessages — same helper as loadConversationForResume.
  // Without it, skill_listing / agent_listing_delta in local JSONL do not arm
  // the one-shot suppress latches on the in-REPL session picker path.
  const agents = [agent('Explore'), agent('Plan')]
  const messages = [
    {
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-00000000sk01',
      attachment: {
        type: 'skill_listing',
        content: 'Available skills:\n- /demo',
        skillCount: 1,
        isInitial: true,
      },
    } as unknown as Message,
    listingDeltaMessage(agents),
  ]
  const ctx = toolUseContext(agents)

  restoreSkillStateFromMessages(messages)
  expect(getAgentListingDeltaAttachment(ctx, messages)).toEqual([])
})
