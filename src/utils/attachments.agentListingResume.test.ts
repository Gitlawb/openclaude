import { afterEach, beforeEach, expect, test } from 'bun:test'
import { AGENT_TOOL_NAME } from '../tools/AgentTool/constants.js'
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import type { Message } from '../types/message.js'
import type { ToolUseContext } from '../Tool.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import {
  getAgentListingDeltaAttachment,
  resetSentSkillNames,
  suppressNextAgentListing,
} from './attachments.js'
import { restoreSkillStateFromMessages } from './conversationRecovery.js'

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
  addedTypes: string[],
  removedTypes: string[] = [],
  isInitial = true,
): Message {
  return {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000a001',
    attachment: {
      type: 'agent_listing_delta',
      addedTypes,
      addedLines: addedTypes.map(t => `- ${t}: stub`),
      removedTypes,
      isInitial,
      showConcurrencyNote: true,
    },
  } as unknown as Message
}

test('suppressNextAgentListing skips duplicate listing once when agent set is unchanged', () => {
  const agents = [agent('Explore'), agent('Plan')]
  const messages = [listingDeltaMessage(['Explore', 'Plan'])]
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
  const messages = [listingDeltaMessage(['Explore'])]
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
  const messages = [listingDeltaMessage(['Explore', 'Plan'])]
  const ctx = toolUseContext(agents)

  restoreSkillStateFromMessages(messages)
  expect(getAgentListingDeltaAttachment(ctx, messages)).toEqual([])
})

test('restoreSkillStateFromMessages still allows agent delta when available set changed', () => {
  const messages = [listingDeltaMessage(['Explore'])]
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
