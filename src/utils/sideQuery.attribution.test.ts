import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetGrowthBook } from '../services/analytics/growthbook.js'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../test/sharedMutationLock.js'
import { getClaudeAIOAuthTokens } from './auth.js'
import { sideQuery } from './sideQuery.js'

const envKeys = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_ATTRIBUTION_HEADER',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_FEATURE_FLAGS_FILE',
  'OPENAI_API_BASE',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENCLAUDE_CONFIG_DIR',
] as const
const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch
const hadSavedMacro = Object.hasOwn(globalThis, 'MACRO')
const savedMacro = (globalThis as Record<string, unknown>).MACRO
let configRoot: string | undefined

function makeMessageResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'msg-side-attribution-test',
      type: 'message',
      role: 'assistant',
      model: 'claude-side-attribution-test',
      content: [],
      container: null,
      context_management: null,
      stop_details: null,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }),
    {
      headers: {
        'content-type': 'application/json',
        'request-id': 'req-side-attribution-test',
      },
    },
  )
}

async function captureSideQuerySystem(
  system:
    | string
    | Array<{
        type: 'text'
        text: string
        cache_control?: { type: 'ephemeral'; scope?: 'global' | 'org' }
      }> = 'stable side prompt',
): Promise<Array<Record<string, unknown>>> {
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = (async (input, init) => {
    const request =
      input instanceof Request
        ? input.clone()
        : new Request(input as RequestInfo, init)
    const body = await request.text()
    if (body) requestBody = JSON.parse(body) as Record<string, unknown>
    return makeMessageResponse()
  }) as typeof fetch

  await sideQuery({
    querySource: 'model_validation',
    model: 'claude-side-attribution-test',
    system,
    messages: [{ role: 'user', content: 'hello' }],
  })

  if (!Array.isArray(requestBody?.system)) {
    throw new Error('expected captured side-query system blocks')
  }
  return requestBody.system as Array<Record<string, unknown>>
}

function blockTexts(blocks: Array<Record<string, unknown>>): string[] {
  return blocks.flatMap(block =>
    typeof block.text === 'string' ? [block.text] : [],
  )
}

beforeEach(async () => {
  await acquireSharedMutationLock('sideQuery.attribution.test.ts')
  configRoot = mkdtempSync(join(tmpdir(), 'side-query-attribution-'))
  for (const key of envKeys) delete process.env[key]
  process.env.ANTHROPIC_API_KEY = 'sk-test-side-query'
  process.env.OPENCLAUDE_CONFIG_DIR = configRoot
  process.env.CLAUDE_FEATURE_FLAGS_FILE = join(
    configRoot,
    'feature-flags.json',
  )
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: '0.0.0-test',
    DISPLAY_VERSION: '0.0.0-test',
    BUILD_TIME: 'test',
    ISSUES_EXPLAINER: 'test',
    PACKAGE_URL: 'test',
    NATIVE_PACKAGE_URL: undefined,
  }
  getClaudeAIOAuthTokens.cache?.clear?.()
  resetGrowthBook()
})

afterEach(() => {
  try {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]
      }
    }
    globalThis.fetch = originalFetch
    if (hadSavedMacro) {
      ;(globalThis as Record<string, unknown>).MACRO = savedMacro
    } else {
      delete (globalThis as Record<string, unknown>).MACRO
    }
    getClaudeAIOAuthTokens.cache?.clear?.()
    resetGrowthBook()
    if (configRoot) {
      rmSync(configRoot, { recursive: true, force: true })
      configRoot = undefined
    }
  } finally {
    releaseSharedMutationLock()
  }
})

describe('sideQuery Anthropic attribution', () => {
  test('strips the block from a custom native endpoint', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://custom-anthropic.example/v1'

    const texts = blockTexts(
      await captureSideQuerySystem([
        { type: 'text', text: 'x-anthropic-billing-header: stale' },
        { type: 'text', text: 'stable side prompt' },
      ]),
    )

    expect(
      texts.some(text => text.startsWith('x-anthropic-billing-header')),
    ).toBe(false)
    expect(texts).toContain('stable side prompt')
  })

  test('honors the disabled setting for an official API key', async () => {
    process.env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'

    const texts = blockTexts(await captureSideQuerySystem())

    expect(
      texts.some(text => text.startsWith('x-anthropic-billing-header')),
    ).toBe(false)
    expect(texts).toContain('stable side prompt')
  })

  test('keeps the block for official OAuth when globally disabled', async () => {
    delete process.env.ANTHROPIC_API_KEY
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-test-token'
    process.env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'
    getClaudeAIOAuthTokens.cache?.clear?.()

    const texts = blockTexts(await captureSideQuerySystem())

    expect(
      texts.some(text => text.startsWith('x-anthropic-billing-header')),
    ).toBe(true)
    expect(texts).toContain('stable side prompt')
  })

  test('keeps one generated block and preserves cache metadata order', async () => {
    const blocks = await captureSideQuerySystem([
      { type: 'text', text: 'x-anthropic-billing-header: stale' },
      {
        type: 'text',
        text: 'stable cached side prompt',
        cache_control: { type: 'ephemeral', scope: 'org' },
      },
    ])

    const texts = blockTexts(blocks)
    expect(
      texts.filter(text => text.startsWith('x-anthropic-billing-header')),
    ).toHaveLength(1)
    expect(texts[1]).toBe('stable cached side prompt')
    expect(blocks[1]?.cache_control).toEqual({
      type: 'ephemeral',
      scope: 'org',
    })
  })
})
