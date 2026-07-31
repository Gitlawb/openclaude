import { afterEach, beforeEach, expect, test } from 'bun:test'
import type { Message } from '../types/message.js'
import { createAttachmentMessage } from './attachments.js'
import {
  hydrateListingAttachmentsFromResumeCache,
  resetResumeCacheForTesting,
  updateResumeCacheFromMessages,
} from './resumeCache.js'

const SESSION = 'test-resume-cache-pr2070'

beforeEach(() => {
  resetResumeCacheForTesting()
})

afterEach(() => {
  resetResumeCacheForTesting()
})

function skillListing(content: string, skillCount = 1): Message {
  return createAttachmentMessage({
    type: 'skill_listing',
    content,
    skillCount,
    isInitial: true,
  })
}

function agentListing(
  types: string[],
  lines: string[],
  removedTypes: string[] = [],
): Message {
  return createAttachmentMessage({
    type: 'agent_listing_delta',
    addedTypes: types,
    addedLines: lines,
    removedTypes,
    isInitial: removedTypes.length === 0 && types.length > 0,
    showConcurrencyNote: true,
  })
}

function deferredListing(names: string[], lines: string[]): Message {
  return createAttachmentMessage({
    type: 'deferred_tools_delta',
    addedNames: names,
    addedLines: lines,
    removedNames: [],
  })
}

function mcpListing(names: string[], blocks: string[]): Message {
  return createAttachmentMessage({
    type: 'mcp_instructions_delta',
    addedNames: names,
    addedBlocks: blocks,
    removedNames: [],
  })
}

function listingTypes(messages: Message[]): string[] {
  return messages
    .filter(m => m.type === 'attachment')
    .map(m =>
      m.attachment && typeof m.attachment === 'object'
        ? (m.attachment as { type: string }).type
        : '',
    )
    .filter(Boolean)
}

test('hydrateListingAttachmentsFromResumeCache is a no-op for empty cache', async () => {
  const messages: Message[] = [
    {
      type: 'user',
      uuid: '00000000-0000-4000-8000-00000000u001',
      message: { role: 'user', content: 'hi' },
    } as unknown as Message,
  ]
  const out = await hydrateListingAttachmentsFromResumeCache(messages, SESSION)
  expect(out).toBe(messages)
})

test('hydrateListingAttachmentsFromResumeCache skips when listing already present', async () => {
  updateResumeCacheFromMessages(
    [skillListing('## Skills\n- foo')],
    SESSION,
  )
  const messages = [skillListing('## Skills\n- already')]
  const out = await hydrateListingAttachmentsFromResumeCache(messages, SESSION)
  expect(out).toBe(messages)
  expect(listingTypes(out)).toEqual(['skill_listing'])
})

test('hydrateListingAttachmentsFromResumeCache injects deferred→agent→mcp→skill order', async () => {
  updateResumeCacheFromMessages(
    [
      skillListing('## Skills\n- s1'),
      agentListing(['Explore'], ['- Explore: explore work']),
      deferredListing(['ToolA'], ['ToolA — deferred']),
      mcpListing(['docs'], ['## docs\nUse search.']),
    ],
    SESSION,
  )

  const out = await hydrateListingAttachmentsFromResumeCache([], SESSION)
  expect(listingTypes(out)).toEqual([
    'deferred_tools_delta',
    'agent_listing_delta',
    'mcp_instructions_delta',
    'skill_listing',
  ])
})

test('updateResumeCacheFromMessages dedupes skill_listing by contentHash', async () => {
  const listing = skillListing('## Skills\n- foo\n- bar', 2)
  updateResumeCacheFromMessages([listing], SESSION)
  updateResumeCacheFromMessages([listing], SESSION)
  updateResumeCacheFromMessages([listing], SESSION)

  const out = await hydrateListingAttachmentsFromResumeCache([], SESSION)
  const skills = out.filter(
    m =>
      m.type === 'attachment' &&
      m.attachment &&
      typeof m.attachment === 'object' &&
      (m.attachment as { type: string }).type === 'skill_listing',
  )
  expect(skills).toHaveLength(1)
})

test('updateResumeCacheFromMessages merges agent listing deltas across slices', async () => {
  updateResumeCacheFromMessages(
    [agentListing(['Explore'], ['- Explore: old'])],
    SESSION,
  )
  updateResumeCacheFromMessages(
    [
      agentListing(
        ['Plan'],
        ['- Plan: plan work'],
        ['Explore'],
      ),
    ],
    SESSION,
  )

  const out = await hydrateListingAttachmentsFromResumeCache([], SESSION)
  const agentMsg = out.find(
    m =>
      m.type === 'attachment' &&
      m.attachment &&
      typeof m.attachment === 'object' &&
      (m.attachment as { type: string }).type === 'agent_listing_delta',
  )
  expect(agentMsg).toBeDefined()
  const att = agentMsg!.attachment as {
    addedTypes: string[]
    addedLines: string[]
  }
  expect(att.addedTypes).toEqual(['Plan'])
  expect(att.addedLines[0]).toContain('Plan')
})

test('updateResumeCacheFromMessages skips malformed null attachment without throwing', () => {
  const malformed = {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000bad1',
    attachment: null,
  } as unknown as Message

  expect(() =>
    updateResumeCacheFromMessages(
      [malformed, skillListing('## Skills\n- ok')],
      SESSION,
    ),
  ).not.toThrow()
})
