import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { buildInheritedCliFlags, buildInheritedEnvVars } from './spawnUtils.js'

const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  await acquireSharedMutationLock('utils/swarm/spawnUtils.test.ts')
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
})

afterEach(() => {
  try {
    for (const key of Object.keys(process.env)) {
      delete process.env[key]
    }
    Object.assign(process.env, ORIGINAL_ENV)
  } finally {
    releaseSharedMutationLock()
  }
})

test('buildInheritedEnvVars marks spawned teammates as host-managed for provider routing', () => {
  const envVars = buildInheritedEnvVars()

  expect(envVars).toContain('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1')
})

test('buildInheritedEnvVars forwards pooled OpenAI credentials', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_API_KEYS = 'key-a,key-b'

  const envVars = buildInheritedEnvVars()

  expect(envVars).toContain('CLAUDE_CODE_USE_OPENAI=1')
  expect(envVars).toContain('OPENAI_API_KEYS=key-a\\,key-b')
})

test('buildInheritedEnvVars forwards complete custom OpenAI profile routing', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED = '1'
  process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID = 'custom-profile'
  process.env.OPENAI_BASE_URL = 'https://proxy.example/v1'
  process.env.OPENAI_MODEL = 'custom-model'
  process.env.OPENAI_API_FORMAT = 'responses'
  process.env.OPENAI_AUTH_HEADER = 'X-Proxy-Key'
  process.env.OPENAI_AUTH_SCHEME = 'raw'
  process.env.OPENAI_AUTH_HEADER_VALUE = 'proxy-secret'

  const envVars = buildInheritedEnvVars()

  expect(envVars).toContain('CLAUDE_CODE_PROVIDER_ROUTE_ID=custom')
  expect(envVars).toContain('CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED=1')
  expect(envVars).toContain(
    'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID=custom-profile',
  )
  expect(envVars).toContain('OPENAI_BASE_URL=https\\://proxy.example/v1')
  expect(envVars).toContain('OPENAI_MODEL=custom-model')
  expect(envVars).toContain('OPENAI_API_FORMAT=responses')
  expect(envVars).toContain('OPENAI_AUTH_HEADER=X-Proxy-Key')
  expect(envVars).toContain('OPENAI_AUTH_SCHEME=raw')
  expect(envVars).toContain('OPENAI_AUTH_HEADER_VALUE=proxy-secret')
})

test.each([
  {
    routeId: 'llmtr',
    baseUrl: 'https://llmtr.com/v1',
    credentialEnvVar: 'LLMTR_API_KEY',
  },
  {
    routeId: 'apismart',
    baseUrl: 'https://gw.apismart.ai/v1',
    credentialEnvVar: 'APISMART_API_KEY',
  },
  {
    routeId: 'atlas-cloud',
    baseUrl: 'https://api.atlascloud.ai/v1',
    credentialEnvVar: 'ATLAS_CLOUD_API_KEY',
  },
])(
  'buildInheritedEnvVars derives $routeId teammate credentials from route metadata',
  ({ routeId, baseUrl, credentialEnvVar }) => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = baseUrl
    process.env.OPENAI_MODEL = 'test-model'
    process.env.OPENAI_API_KEY = 'mirrored-secret'
    process.env[credentialEnvVar] = 'route-secret'

    const envVars = buildInheritedEnvVars()

    expect(envVars).toContain(`CLAUDE_CODE_PROVIDER_ROUTE_ID=${routeId}`)
    expect(envVars).toContain(
      `CLAUDE_CODE_PROVIDER_MANAGED_CREDENTIAL_ENV_VARS=${credentialEnvVar}`,
    )
    expect(envVars).toContain(`${credentialEnvVar}=route-secret`)
  },
)

test('buildInheritedEnvVars scopes dedicated credentials to the resolved route', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.CLAUDE_CODE_PROVIDER_ROUTE_ID = 'openai'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_API_KEY = 'openai-secret'
  process.env.LLMTR_API_KEY = 'unrelated-secret'

  const envVars = buildInheritedEnvVars()

  expect(envVars).toContain('CLAUDE_CODE_PROVIDER_ROUTE_ID=openai')
  expect(envVars).toContain('OPENAI_API_KEY=openai-secret')
  expect(envVars).not.toContain('LLMTR_API_KEY')
  expect(envVars).not.toContain('unrelated-secret')
})

test('buildInheritedEnvVars forwards PATH for source-built teammate tool lookups', () => {
  process.env.PATH = '/custom/bin:/usr/bin'

  const envVars = buildInheritedEnvVars()

  expect(envVars).toContain('PATH=')
  expect(envVars).toContain('/custom/bin\\:/usr/bin')
})

test('buildInheritedCliFlags preserves fullAccess mode for spawned teammates', () => {
  process.env.NODE_ENV = 'test'
  const flags = buildInheritedCliFlags({ permissionMode: 'fullAccess' })

  expect(flags).toContain('--permission-mode fullAccess')
  expect(flags).not.toContain('--dangerously-skip-permissions')
})
