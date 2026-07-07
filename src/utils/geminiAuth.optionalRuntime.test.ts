import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { OptionalRuntimeModuleUnavailableError } from './optionalRuntimeModule.js'

const originalEnv = { ...process.env }

beforeEach(async () => {
  await acquireSharedMutationLock('utils/geminiAuth.optionalRuntime.test.ts')
  process.env = { ...originalEnv }
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.GEMINI_ACCESS_TOKEN
  process.env.GEMINI_AUTH_MODE = 'adc'
  process.env.GOOGLE_APPLICATION_CREDENTIALS = import.meta.path
})

afterEach(() => {
  try {
    process.env = { ...originalEnv }
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

test('Gemini ADC reports missing google-auth-library through the optional runtime helper', async () => {
  const importOptionalRuntimeModule = mock(async (specifier: string, feature: string) => {
    throw new OptionalRuntimeModuleUnavailableError(feature, specifier)
  })

  const { resolveGeminiCredential } = await import(
    `./geminiAuth.ts?optional-runtime=${Date.now()}-${Math.random()}`
  )

  await expect(
    resolveGeminiCredential(process.env, { importOptionalRuntimeModule }),
  ).rejects.toThrow(/Gemini Application Default Credentials requires the "google-auth-library" package/)
  expect(importOptionalRuntimeModule).toHaveBeenCalledWith(
    'google-auth-library',
    'Gemini Application Default Credentials',
  )
})

test('Gemini ADC still degrades to none for credential lookup failures', async () => {
  const { resolveGeminiCredential } = await import(
    `./geminiAuth.ts?credential-failure=${Date.now()}-${Math.random()}`
  )

  await expect(
    resolveGeminiCredential(process.env, {
      createGoogleAuth: async () => ({
        getClient: async () => {
          throw new Error('ADC token unavailable')
        },
      }),
    }),
  ).resolves.toEqual({ kind: 'none' })
})
