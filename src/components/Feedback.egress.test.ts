import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Message } from '../types/message.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

type AxiosModule = typeof import('axios')

let originalAxiosModule: AxiosModule | undefined
let originalUserType: string | undefined
let hadMacro = false
let originalMacro: unknown
let tempDir: string | undefined
let postedBodies: Array<{ content?: string }> = []

function buildAxiosModuleStub(
  post: (...args: unknown[]) => Promise<unknown>,
): AxiosModule {
  const instance = {
    get: async () => ({ status: 200 }),
    post,
    isAxiosError: () => false,
    isCancel: () => false,
    defaults: {} as Record<string, unknown>,
    interceptors: {
      request: { use: () => 0, eject: () => {} },
      response: { use: () => 0, eject: () => {} },
    },
  }
  return { default: instance } as unknown as AxiosModule
}

beforeAll(async () => {
  await acquireSharedMutationLock('Feedback.egress')
  originalAxiosModule = await import('axios')
  originalUserType = process.env.USER_TYPE
  hadMacro = Object.prototype.hasOwnProperty.call(globalThis, 'MACRO')
  originalMacro = (globalThis as { MACRO?: unknown }).MACRO
  ;(globalThis as { MACRO?: { VERSION: string } }).MACRO = {
    VERSION: 'test-version',
  }

  const realProviders = await import('../utils/model/providers.js')
  mock.module('../utils/model/providers.js', () => ({
    ...realProviders,
    getAPIProvider: () => 'firstParty',
    isFirstPartyAnthropicBaseUrl: () => true,
  }))

  const realAuth = await import('../utils/auth.js')
  mock.module('../utils/auth.js', () => ({
    ...realAuth,
    checkAndRefreshOAuthTokenIfNeeded: async () => {},
  }))

  const realHttp = await import('../utils/http.js')
  mock.module('../utils/http.js', () => ({
    ...realHttp,
    getAuthHeaders: () => ({
      headers: { Authorization: 'Bearer test' },
      error: undefined,
    }),
    getUserAgent: () => 'test-agent',
  }))

  const realPrivacy = await import('../utils/privacyLevel.js')
  mock.module('../utils/privacyLevel.js', () => ({
    ...realPrivacy,
    isEssentialTrafficOnly: () => false,
  }))

  tempDir = await mkdtemp(join(tmpdir(), 'openclaude-feedback-egress-'))
  const transcriptPath = join(tempDir, 'session.jsonl')
  await writeFile(
    transcriptPath,
    `${JSON.stringify({
      type: 'user',
      uuid: '00000000-0000-4000-8000-00000000f001',
      parentUuid: null,
      timestamp: '2026-08-07T00:00:00.000Z',
      message: { role: 'user', content: 'feedback main turn' },
    })}\n${JSON.stringify({
      type: 'attachment',
      uuid: '00000000-0000-4000-8000-00000000f002',
      parentUuid: '00000000-0000-4000-8000-00000000f001',
      timestamp: '2026-08-07T00:00:00.000Z',
      attachment: {
        type: 'skill_listing',
        content: 'Available skills:\n- /leak-me-please',
        skillCount: 1,
        isInitial: true,
      },
    })}\n`,
  )

  const realSession = await import('../utils/sessionStorage.js')
  mock.module('../utils/sessionStorage.js', () => ({
    ...realSession,
    getTranscriptPath: () => transcriptPath,
    loadAllSubagentTranscriptsFromDisk: async () => ({
      'agent-leak': [
        {
          type: 'attachment',
          uuid: '00000000-0000-4000-8000-00000000a201',
          attachment: {
            type: 'agent_listing_delta',
            addedTypes: ['Explore'],
            addedLines: ['- Explore: /leak-agent-listing'],
            removedTypes: [],
            isInitial: true,
            showConcurrencyNote: false,
          },
        },
        {
          type: 'user',
          uuid: '00000000-0000-4000-8000-00000000a202',
          message: { role: 'user', content: 'subagent turn' },
        },
      ],
    }),
  }))

  mock.module('axios', () =>
    buildAxiosModuleStub(async (_url: unknown, body: unknown) => {
      postedBodies.push(body as { content?: string })
      return { status: 200, data: { feedback_id: 'fb-egress-1' } }
    }),
  )
})

afterAll(async () => {
  try {
    if (originalUserType === undefined) {
      delete process.env.USER_TYPE
    } else {
      process.env.USER_TYPE = originalUserType
    }
    if (!hadMacro) {
      delete (globalThis as { MACRO?: unknown }).MACRO
    } else {
      ;(globalThis as { MACRO?: unknown }).MACRO = originalMacro
    }
    if (originalAxiosModule) {
      mock.module('axios', () => originalAxiosModule!)
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  } finally {
    releaseSharedMutationLock()
  }
})

test('Feedback upload strips listing payloads from the posted content body', async () => {
  postedBodies = []
  process.env.USER_TYPE = 'external'

  const { assembleFeedbackEgressReportData, submitFeedback } = await import(
    './Feedback.js'
  )

  const listing = {
    type: 'attachment',
    uuid: '00000000-0000-4000-8000-00000000m101',
    attachment: {
      type: 'skill_listing',
      content: 'Available skills:\n- /leak-me-please',
      skillCount: 1,
      isInitial: true,
    },
  } as unknown as Message
  const user = {
    type: 'user',
    uuid: '00000000-0000-4000-8000-00000000m102',
    message: { role: 'user', content: 'plain turn' },
  } as unknown as Message

  const report = await assembleFeedbackEgressReportData({
    messages: [listing, user],
    description: 'egress regression',
  })
  const result = await submitFeedback(report)

  expect(result.success).toBe(true)
  expect(postedBodies).toHaveLength(1)
  const content = postedBodies[0]?.content ?? ''
  expect(content).toContain('plain turn')
  expect(content).toContain('subagent turn')
  expect(content).not.toContain('leak-me-please')
  expect(content).not.toContain('leak-agent-listing')
})
