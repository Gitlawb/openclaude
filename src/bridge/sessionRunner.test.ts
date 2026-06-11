import { expect, test } from 'bun:test'
import { buildChildEnv } from './sessionRunner.ts'

// Finding #42-1: sessionRunner spreads the full parent process.env into the
// child process environment, leaking API keys, DB credentials, proxy secrets.
// Only CLAUDE_CODE_OAUTH_TOKEN was stripped. Fix: explicit allowlist.

const baseOpts = {
  accessToken: 'test-access-token',
  useCcrV2: false as const,
}

test('buildChildEnv does not leak ANTHROPIC_API_KEY to child', () => {
  const parentEnv = {
    PATH: '/usr/bin',
    HOME: '/home/user',
    ANTHROPIC_API_KEY: 'sk-ant-secret-key',
    CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'will-be-overwritten',
  }
  const env = buildChildEnv(parentEnv, baseOpts)
  expect(env.ANTHROPIC_API_KEY).toBeUndefined()
})

test('buildChildEnv does not leak OPENAI_API_KEY to child', () => {
  const parentEnv = {
    PATH: '/usr/bin',
    HOME: '/home/user',
    OPENAI_API_KEY: 'sk-openai-secret',
  }
  const env = buildChildEnv(parentEnv, baseOpts)
  expect(env.OPENAI_API_KEY).toBeUndefined()
})

test('buildChildEnv does not leak arbitrary secrets to child', () => {
  const parentEnv = {
    PATH: '/usr/bin',
    HOME: '/home/user',
    DB_PASSWORD: 'super-secret',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    GITHUB_TOKEN: 'ghp_token',
  }
  const env = buildChildEnv(parentEnv, baseOpts)
  expect(env.DB_PASSWORD).toBeUndefined()
  expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  expect(env.GITHUB_TOKEN).toBeUndefined()
})

test('buildChildEnv includes PATH and HOME from parent', () => {
  const parentEnv = {
    PATH: '/usr/bin:/usr/local/bin',
    HOME: '/home/user',
    ANTHROPIC_API_KEY: 'sk-secret',
  }
  const env = buildChildEnv(parentEnv, baseOpts)
  expect(env.PATH).toBe('/usr/bin:/usr/local/bin')
  expect(env.HOME).toBe('/home/user')
})

test('buildChildEnv sets CLAUDE_CODE_SESSION_ACCESS_TOKEN from opts', () => {
  const env = buildChildEnv(
    { PATH: '/usr/bin' },
    { ...baseOpts, accessToken: 'my-token' },
  )
  expect(env.CLAUDE_CODE_SESSION_ACCESS_TOKEN).toBe('my-token')
})

test('buildChildEnv sets CLAUDE_CODE_ENVIRONMENT_KIND to bridge', () => {
  const env = buildChildEnv({ PATH: '/usr/bin' }, baseOpts)
  expect(env.CLAUDE_CODE_ENVIRONMENT_KIND).toBe('bridge')
})

test('buildChildEnv does not pass CLAUDE_CODE_OAUTH_TOKEN to child', () => {
  const parentEnv = {
    PATH: '/usr/bin',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-to-strip',
  }
  const env = buildChildEnv(parentEnv, baseOpts)
  expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
})

test('buildChildEnv sets CCR v2 vars when useCcrV2 is true', () => {
  const env = buildChildEnv(
    { PATH: '/usr/bin' },
    { accessToken: 'tok', useCcrV2: true, workerEpoch: 42 },
  )
  expect(env.CLAUDE_CODE_USE_CCR_V2).toBe('1')
  expect(env.CLAUDE_CODE_WORKER_EPOCH).toBe('42')
})
