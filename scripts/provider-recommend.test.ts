import { describe, expect, test } from 'bun:test'
import { getOpenAIConfigurationState } from './provider-recommend.ts'

function envWithOpenAI(
  patch: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const env = { ...process.env, ...patch }
  for (const key of ['OPENAI_API_KEYS', 'OPENAI_API_KEY']) {
    if (patch[key] === undefined) {
      delete env[key]
    }
  }
  return env
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text()
}

describe('provider-recommend OpenAI credential detection', () => {
  test('detects valid pooled OpenAI credentials', () => {
    expect(
      getOpenAIConfigurationState(
        envWithOpenAI({
          OPENAI_API_KEYS: 'key-a,key-b',
          OPENAI_API_KEY: undefined,
        }),
      ),
    ).toEqual({ configured: true, invalid: false })
  })

  test('ignores placeholder OPENAI_API_KEY when OPENAI_API_KEYS is usable', () => {
    expect(
      getOpenAIConfigurationState(
        envWithOpenAI({
          OPENAI_API_KEYS: 'key-a,key-b',
          OPENAI_API_KEY: 'SUA_CHAVE',
        }),
      ),
    ).toEqual({ configured: true, invalid: false })
  })

  test('distinguishes placeholder pools from unset credentials', () => {
    expect(
      getOpenAIConfigurationState(
        envWithOpenAI({
          OPENAI_API_KEYS: 'key-a,SUA_CHAVE',
          OPENAI_API_KEY: undefined,
        }),
      ),
    ).toEqual({ configured: false, invalid: true })

    expect(
      getOpenAIConfigurationState(
        envWithOpenAI({
          OPENAI_API_KEYS: undefined,
          OPENAI_API_KEY: undefined,
        }),
      ),
    ).toEqual({ configured: false, invalid: false })
  })

  test('profile:recommend openai path runs with pooled credentials', async () => {
    const env = envWithOpenAI({
      OPENAI_API_KEYS: 'key-a,key-b',
      OPENAI_API_KEY: undefined,
      NO_COLOR: '1',
    })
    const proc = Bun.spawn(
      [
        process.execPath,
        'run',
        'scripts/provider-recommend.ts',
        '--provider',
        'openai',
        '--json',
      ],
      {
        cwd: process.cwd(),
        env,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )

    const [stdout, stderr, exitCode] = await Promise.all([
      readStream(proc.stdout),
      readStream(proc.stderr),
      proc.exited,
    ])

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout).openAIConfigured).toBe(true)
  })
})