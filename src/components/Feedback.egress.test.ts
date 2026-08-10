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
type ProvidersModule = typeof import('../utils/model/providers.js')
type AuthModule = typeof import('../utils/auth.js')
type HttpModule = typeof import('../utils/http.js')
type PrivacyModule = typeof import('../utils/privacyLevel.js')

let originalAxiosModule: AxiosModule | undefined
let originalProvidersModule: ProvidersModule | undefined
let originalAuthModule: AuthModule | undefined
let originalHttpModule: HttpModule | undefined
let originalPrivacyModule: PrivacyModule | undefined
let originalUserType: string | undefined
let hadMacro = false
let originalMacro: unknown
let tempDir: string | undefined
let transcriptPath: string | undefined
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

  originalProvidersModule = await import('../utils/model/providers.js')
  mock.module('../utils/model/providers.js', () => ({
    ...originalProvidersModule!,
    getAPIProvider: () => 'firstParty',
    isFirstPartyAnthropicBaseUrl: () => true,
  }))

  originalAuthModule = await import('../utils/auth.js')
  mock.module('../utils/auth.js', () => ({
    ...originalAuthModule!,
    checkAndRefreshOAuthTokenIfNeeded: async () => {},
  }))

  originalHttpModule = await import('../utils/http.js')
  mock.module('../utils/http.js', () => ({
    ...originalHttpModule!,
    getAuthHeaders: () => ({
      headers: { Authorization: 'Bearer test' },
      error: undefined,
    }),
    getUserAgent: () => 'test-agent',
  }))

  originalPrivacyModule = await import('../utils/privacyLevel.js')
  mock.module('../utils/privacyLevel.js', () => ({
    ...originalPrivacyModule!,
    isEssentialTrafficOnly: () => false,
  }))

  tempDir = await mkdtemp(join(tmpdir(), 'openclaude-feedback-egress-'))
  transcriptPath = join(tempDir, 'session.jsonl')
  // f001 user → f002 listing (omitted) → f003 user (parent=f002, must reparent to f001)
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
    })}\n${JSON.stringify({
      type: 'user',
      uuid: '00000000-0000-4000-8000-00000000f003',
      parentUuid: '00000000-0000-4000-8000-00000000f002',
      timestamp: '2026-08-07T00:00:01.000Z',
      message: { role: 'user', content: 'after listing turn' },
    })}\n`,
  )

  // Do NOT mock.module sessionStorage — that leaks into later suites under
  // --max-concurrency=1. Pass transcript / subagent data via test seams.
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
    if (originalProvidersModule) {
      mock.module('../utils/model/providers.js', () => originalProvidersModule!)
    }
    if (originalAuthModule) {
      mock.module('../utils/auth.js', () => originalAuthModule!)
    }
    if (originalHttpModule) {
      mock.module('../utils/http.js', () => originalHttpModule!)
    }
    if (originalPrivacyModule) {
      mock.module('../utils/privacyLevel.js', () => originalPrivacyModule!)
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
    transcriptPathForTesting: transcriptPath,
    subagentTranscriptsForTesting: {
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
        } as unknown as Message,
        {
          type: 'user',
          uuid: '00000000-0000-4000-8000-00000000a202',
          message: { role: 'user', content: 'subagent turn' },
        } as unknown as Message,
      ],
    },
  })
  const result = await submitFeedback(report)

  expect(result.success).toBe(true)
  expect(postedBodies).toHaveLength(1)
  const content = postedBodies[0]?.content ?? ''
  expect(content).toContain('plain turn')
  expect(content).toContain('feedback main turn')
  expect(content).toContain('after listing turn')
  expect(content).toContain('subagent turn')
  expect(content).not.toContain('leak-me-please')
  expect(content).not.toContain('leak-agent-listing')

  // Posted report embeds filtered rawTranscriptJsonl — survivor f003 must
  // reparent from omitted f002 onto retained ancestor f001.
  const parsed = JSON.parse(content) as { rawTranscriptJsonl?: string }
  expect(parsed.rawTranscriptJsonl).toBeDefined()
  const lines = (parsed.rawTranscriptJsonl ?? '')
    .split('\n')
    .filter(l => l.length > 0)
    .map(
      line =>
        JSON.parse(line) as {
          uuid?: string
          parentUuid?: string | null
        },
    )
  const afterListing = lines.find(
    e => e.uuid === '00000000-0000-4000-8000-00000000f003',
  )
  expect(afterListing).toBeDefined()
  expect(afterListing?.parentUuid).toBe(
    '00000000-0000-4000-8000-00000000f001',
  )
  expect(
    lines.some(e => e.uuid === '00000000-0000-4000-8000-00000000f002'),
  ).toBe(false)
})
