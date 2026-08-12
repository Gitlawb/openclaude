import { describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import xai from './xai.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'

const mapModel = xai.catalog?.discovery?.mapModel

function shape(id: string, extras: Record<string, unknown> = {}) {
  return { id, ...extras }
}

describe('xAI vendor hybrid catalog', () => {
  test('uses hybrid discovery with curated Grok 4.6 as the default', () => {
    expect(mapModel).toBeDefined()
    expect(xai.catalog?.source).toBe('hybrid')
    expect(xai.catalog?.discovery?.kind).toBe('openai-compatible')
    expect(xai.catalog?.discoveryCacheTtl).toBe('1d')
    expect(xai.catalog?.discoveryRefreshMode).toBe('background-if-stale')
    expect(xai.catalog?.allowManualRefresh).toBe(true)
    expect(xai.defaultModel).toBe('grok-4.6')
    expect(xai.catalog?.models?.map(model => model.apiName)).toEqual([
      'grok-4.6',
      'grok-4.5',
      'grok-4.3',
      'grok-build-0.1',
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
    ])
  })

  test('keeps chat Grok IDs including later uncataloged releases', () => {
    if (!mapModel) throw new Error('mapModel missing')
    const keep = [
      'grok-4.6',
      'grok-4.5',
      'grok-4.3',
      'grok-4.7',
      'grok-build-0.1',
      'grok-4.20-0309-reasoning',
      'grok-4.20-multi-agent-0309',
    ]
    for (const id of keep) {
      expect(mapModel(shape(id))).toEqual({
        id,
        apiName: id,
        label: id,
      })
    }
  })

  test('drops Imagine, voice, STT/TTS, and embedding models', () => {
    if (!mapModel) throw new Error('mapModel missing')
    const drop = [
      'grok-imagine-image',
      'grok-imagine-image-quality',
      'grok-imagine-video-1.5',
      'grok-voice-think-fast-1.0',
      'grok-voice-think-fast-2.0',
      'grok-stt-1.0',
      'grok-tts-1.0',
    ]
    for (const id of drop) {
      expect(mapModel(shape(id))).toBeNull()
    }
  })

  test('drops curated aliases so hybrid merge does not duplicate them', () => {
    if (!mapModel) throw new Error('mapModel missing')
    const drop = [
      'latest',
      'grok-4.6-latest',
      'grok-4.5-latest',
      'grok-build-latest',
      'grok-latest',
      'grok-code-fast-1',
    ]
    for (const id of drop) {
      expect(mapModel(shape(id))).toBeNull()
    }
  })

  test('drops inactive entries, missing ids, and non-positive context limits', () => {
    if (!mapModel) throw new Error('mapModel missing')
    expect(mapModel(shape('grok-4.6', { active: false }))).toBeNull()
    expect(mapModel(null)).toBeNull()
    expect(mapModel({})).toBeNull()
    expect(mapModel({ id: 1 })).toBeNull()
    expect(mapModel({ id: '' })).toBeNull()
    expect(mapModel(shape('grok-4.7', { context_length: 0 }))).toEqual({
      id: 'grok-4.7',
      apiName: 'grok-4.7',
      label: 'grok-4.7',
    })
    expect(mapModel(shape('grok-4.7', { context_length: Number.NaN }))).toEqual({
      id: 'grok-4.7',
      apiName: 'grok-4.7',
      label: 'grok-4.7',
    })
  })

  test('forwards the /v1/models context_length when present', () => {
    if (!mapModel) throw new Error('mapModel missing')
    expect(mapModel(shape('grok-4.6', { context_length: 500000 }))).toEqual({
      id: 'grok-4.6',
      apiName: 'grok-4.6',
      label: 'grok-4.6',
      contextWindow: 500000,
    })
  })

  test('hybrid discovery authenticates with xAI OAuth when env keys are absent', async () => {
    await acquireSharedMutationLock('xai.test.ts-oauth-discovery')
    const originalFetch = globalThis.fetch
    const originalXaiKey = process.env.XAI_API_KEY
    const originalOpenAIKey = process.env.OPENAI_API_KEY
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-xai-discovery-'))
    const xaiCredentials = await import('../../utils/xaiCredentials.js')
    const tokenSpy = spyOn(xaiCredentials, 'resolveXaiAccessToken').mockImplementation(
      async () => 'oauth-token',
    )
    setClaudeConfigHomeDirForTesting(tempDir)
    try {
      delete process.env.XAI_API_KEY
      delete process.env.OPENAI_API_KEY
      let authHeader: string | null = null
      globalThis.fetch = mock((_input, init) => {
        authHeader = new Headers(init?.headers as HeadersInit | undefined).get(
          'Authorization',
        )
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [{ id: 'grok-4.7', context_window: 500000 }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }) as unknown as typeof globalThis.fetch

      const { discoverModelsForRoute } = await import(
        `../discoveryService.js?ts=${Date.now()}-${Math.random()}`
      )
      const result = await discoverModelsForRoute('xai', { forceRefresh: true })
      expect(authHeader).toBe('Bearer oauth-token')
      expect(result?.source).toBe('network')
      expect(result?.models.map(model => model.apiName)).toContain('grok-4.6')
      expect(result?.models.map(model => model.apiName)).toContain('grok-4.7')
    } finally {
      tokenSpy.mockRestore()
      globalThis.fetch = originalFetch
      setClaudeConfigHomeDirForTesting(undefined)
      if (originalXaiKey === undefined) {
        delete process.env.XAI_API_KEY
      } else {
        process.env.XAI_API_KEY = originalXaiKey
      }
      if (originalOpenAIKey === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = originalOpenAIKey
      }
      rmSync(tempDir, { recursive: true, force: true })
      releaseSharedMutationLock()
    }
  })
})
