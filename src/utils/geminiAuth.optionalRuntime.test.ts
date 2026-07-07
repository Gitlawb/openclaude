import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

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
    throw new Error(
      `${feature} requires the "${specifier}" package, which is not installed. ` +
        `Install it with \`npm install ${specifier}\` (add \`-g\` if you installed the CLI globally) to enable it.`,
    )
  })

  const { resolveGeminiCredential } = await import(
    `./geminiAuth.ts?optional-runtime=${Date.now()}-${Math.random()}`
  )

  await expect(
    resolveGeminiCredential(process.env, { importOptionalRuntimeModule }),
  ).resolves.toEqual({ kind: 'none' })
  expect(importOptionalRuntimeModule).toHaveBeenCalledWith(
    'google-auth-library',
    'Gemini Application Default Credentials',
  )
})
