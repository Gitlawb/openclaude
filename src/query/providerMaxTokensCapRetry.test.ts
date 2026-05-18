import { expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'

import { query, type QueryParams } from '../query.js'
import type { QueryDeps } from './deps.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  createUserMessage,
} from '../utils/messages.js'
import { asSystemPrompt } from '../utils/systemPromptType.js'
import { getAssistantMessageFromError } from '../services/api/errors.js'

function makeToolUseContext(): QueryParams['toolUseContext'] {
  const abortController = new AbortController()

  return {
    abortController,
    getAppState: () => ({
      fastMode: false,
      mcp: { tools: {}, clients: [] },
      toolPermissionContext: { mode: 'default' },
      sessionHooks: new Map(),
      mainLoopModel: 'gpt-4o',
      effortValue: undefined,
      advisorModel: undefined,
    }),
    options: {
      thinkingConfig: { type: 'disabled' },
      tools: [],
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allowedAgentTypes: undefined },
      appendSystemPrompt: undefined,
      providerOverride: undefined,
      mainLoopModel: 'gpt-4o',
    },
    addNotification: () => {},
  } as QueryParams['toolUseContext']
}

function makeParams(callModel: QueryDeps['callModel']): QueryParams {
  return {
    messages: [createUserMessage({ content: 'hello' })],
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    canUseTool: async () => ({ result: true }),
    toolUseContext: makeToolUseContext(),
    querySource: 'sdk',
    deps: {
      callModel,
      microcompact: async messages => ({ messages }),
      autocompact: async () => ({
        compactionResult: null,
        consecutiveFailures: undefined,
      }),
      uuid: () => '00000000-0000-4000-8000-000000000000',
    } as QueryDeps,
  }
}

async function collect(
  params: QueryParams,
): Promise<Array<Awaited<ReturnType<ReturnType<typeof query>['next']>>['value']>> {
  const previousSimple = process.env.CLAUDE_CODE_SIMPLE
  process.env.CLAUDE_CODE_SIMPLE = '1'
  const messages = []
  try {
    for await (const message of query(params)) {
      messages.push(message)
    }
  } finally {
    if (previousSimple === undefined) {
      delete process.env.CLAUDE_CODE_SIMPLE
    } else {
      process.env.CLAUDE_CODE_SIMPLE = previousSimple
    }
  }
  return messages
}

test('retries once with provider-capped max output tokens', async () => {
  const seenOverrides: Array<number | undefined> = []
  const callModel: QueryDeps['callModel'] = async function* ({ options }) {
    seenOverrides.push(options.maxOutputTokensOverride)

    if (seenOverrides.length === 1) {
      yield getAssistantMessageFromError(
        APIError.generate(
          400,
          undefined,
          'OpenAI API error 400: requested up to 32000 tokens, but can only afford 27342. [openai_category=unknown]',
          new Headers(),
        ),
        'openrouter/model',
      )
      return
    }

    yield createAssistantMessage({ content: 'ok after retry' })
  }

  const messages = await collect(makeParams(callModel))

  expect(seenOverrides).toEqual([undefined, 27_342])
  expect(
    messages.some(
      message =>
        message?.type === 'system' &&
        message?.content?.includes(
          'Provider limited max_tokens to 27,342; retrying with that cap.',
        ),
    ),
  ).toBe(true)
  expect(
    messages.some(
      message =>
        message?.type === 'assistant' &&
        message?.message?.content?.[0]?.text === 'Provider max_tokens limit was lower than requested.',
    ),
  ).toBe(false)
})

test('does not loop if the reduced-cap retry fails', async () => {
  const seenOverrides: Array<number | undefined> = []
  const callModel: QueryDeps['callModel'] = async function* ({ options }) {
    seenOverrides.push(options.maxOutputTokensOverride)
    const cap = seenOverrides.length === 1 ? 27_342 : 16_384
    yield createAssistantAPIErrorMessage({
      content: 'Provider max_tokens limit was lower than requested.',
      apiError: 'max_tokens_too_high',
      error: 'invalid_request',
      errorDetails: `requested up to 32000 tokens, but can only afford ${cap}`,
    })
  }

  const messages = await collect(makeParams(callModel))

  expect(seenOverrides).toEqual([undefined, 27_342])
  expect(
    messages.filter(
      message =>
        message?.type === 'assistant' &&
        message?.message?.content?.[0]?.text === 'Provider max_tokens limit was lower than requested.',
    ),
  ).toHaveLength(1)
})

test('does not retry malformed provider cap errors', async () => {
  const seenOverrides: Array<number | undefined> = []
  const callModel: QueryDeps['callModel'] = async function* ({ options }) {
    seenOverrides.push(options.maxOutputTokensOverride)
    yield createAssistantAPIErrorMessage({
      content: 'Provider max_tokens limit was lower than requested.',
      apiError: 'max_tokens_too_high',
      error: 'invalid_request',
      errorDetails: 'max_tokens exceeds maximum output tokens',
    })
  }

  const messages = await collect(makeParams(callModel))

  expect(seenOverrides).toEqual([undefined])
  expect(
    messages.filter(
      message =>
        message?.type === 'assistant' &&
        message?.message?.content?.[0]?.text === 'Provider max_tokens limit was lower than requested.',
    ),
  ).toHaveLength(1)
})

test('does not retry when provider cap is not lower than the current override', async () => {
  const seenOverrides: Array<number | undefined> = []
  const callModel: QueryDeps['callModel'] = async function* ({ options }) {
    seenOverrides.push(options.maxOutputTokensOverride)
    yield createAssistantAPIErrorMessage({
      content: 'Provider max_tokens limit was lower than requested.',
      apiError: 'max_tokens_too_high',
      error: 'invalid_request',
      errorDetails: 'max_tokens exceeds maximum output tokens for this model: 16384',
    })
  }

  const params = makeParams(callModel)
  params.maxOutputTokensOverride = 8_192

  const messages = await collect(params)

  expect(seenOverrides).toEqual([8_192])
  expect(
    messages.some(
      message =>
        message?.type === 'system' &&
        message?.content?.includes('retrying with that cap'),
    ),
  ).toBe(false)
  expect(
    messages.filter(
      message =>
        message?.type === 'assistant' &&
        message?.message?.content?.[0]?.text === 'Provider max_tokens limit was lower than requested.',
    ),
  ).toHaveLength(1)
})
