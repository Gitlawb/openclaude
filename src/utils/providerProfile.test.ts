import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DEFAULT_CODEX_BASE_URL } from '../services/api/providerConfig.js'
import {
  applySavedProfileToCurrentSession,
  buildStartupEnvFromProfile,
  buildAtomicChatProfileEnv,
  buildCodexProfileEnv,
  buildGeminiProfileEnv,
  buildLaunchEnv,
  buildOllamaProfileEnv,
  buildOpenAIProfileEnv,
  clearPersistedCodexOAuthProfile,
  createProfileFile,
  isPersistedCodexOAuthProfile,
  maskSecretForDisplay,
  loadProfileFile,
  PROFILE_FILE_NAME,
  redactSecretValueForDisplay,
  saveProfileFile,
  sanitizeProviderConfigValue,
  selectAutoProfile,
  type ProfileFile,
} from './providerProfile.js'

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

function profile(profile: ProfileFile['profile'], env: ProfileFile['env']): ProfileFile {
  return {
    profile,
    env,
    createdAt: '2026-04-01T00:00:00.000Z',
  }
}

async function importFreshProviderProfileModule() {
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./providerProfile.js?ts=${nonce}`)
}

const missingCodexAuthPath = join(tmpdir(), 'openclaude-missing-codex-auth.json')

test('matching persisted ollama env is reused for ollama launch', async () => {
  const env = await buildLaunchEnv({
    profile: 'ollama',
    persisted: profile('ollama', {
      OPENAI_BASE_URL: 'http://127.0.0.1:11435/v1',
      OPENAI_MODEL: 'mistral:7b-instruct',
    }),
    goal: 'balanced',
    processEnv: {},
    getOllamaChatBaseUrl: () => 'http://localhost:11434/v1',
    resolveOllamaDefaultModel: async () => 'llama3.1:8b',
  })

  assert.equal(env.OPENAI_BASE_URL, 'http://127.0.0.1:11435/v1')
  assert.equal(env.OPENAI_MODEL, 'mistral:7b-instruct')
})

test('ollama launch ignores mismatched persisted openai env and shell model fallback', async () => {
  const env = await buildLaunchEnv({
    profile: 'ollama',
    persisted: profile('openai', {
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_API_KEY: 'sk-persisted',
    }),
    goal: 'coding',
    processEnv: {
      OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
      OPENAI_MODEL: 'gpt-4o-mini',
      OPENAI_API_KEY: 'sk-live',
      CODEX_API_KEY: 'codex-live',
      CHATGPT_ACCOUNT_ID: 'acct_live',
    },
    getOllamaChatBaseUrl: () => 'http://localhost:11434/v1',
    resolveOllamaDefaultModel: async () => 'qwen2.5-coder:7b',
  })

  assert.equal(env.OPENAI_BASE_URL, 'http://localhost:11434/v1')
  assert.equal(env.OPENAI_MODEL, 'qwen2.5-coder:7b')
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.CODEX_API_KEY, undefined)
  assert.equal(env.CHATGPT_ACCOUNT_ID, undefined)
})

test('openai launch ignores mismatched persisted ollama env', async () => {
  const env = await buildLaunchEnv({
    profile: 'openai',
    persisted: profile('ollama', {
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'llama3.1:8b',
    }),
    goal: 'latency',
    processEnv: {
      OPENAI_API_KEY: 'sk-live',
      CODEX_API_KEY: 'codex-live',
      CHATGPT_ACCOUNT_ID: 'acct_live',
    },
    getOllamaChatBaseUrl: () => 'http://localhost:11434/v1',
    resolveOllamaDefaultModel: async () => 'llama3.1:8b',
  })

  assert.equal(env.OPENAI_BASE_URL, 'https://api.openai.com/v1')
  assert.equal(env.OPENAI_MODEL, 'gpt-4o-mini')
  assert.equal(env.OPENAI_API_KEY, 'sk-live')
  assert.equal(env.CODEX_API_KEY, undefined)
  assert.equal(env.CHATGPT_ACCOUNT_ID, undefined)
})

test('openai launch omits api key when no key is resolved', async () => {
  const env = await buildLaunchEnv({
    profile: 'openai',
    persisted: profile('openai', {
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-4o',
    }),
    goal: 'balanced',
    processEnv: {
      OPENAI_API_KEY: undefined as any,
    },
  })

  assert.equal(env.OPENAI_BASE_URL, 'https://api.openai.com/v1')
  assert.equal(env.OPENAI_MODEL, 'gpt-4o')
  assert.equal(Object.hasOwn(env, 'OPENAI_API_KEY'), false)
})

test('openai launch ignores codex shell transport hints', async () => {
  const env = await buildLaunchEnv({
    profile: 'openai',
    persisted: null,
    goal: 'balanced',
    processEnv: {
      OPENAI_API_KEY: 'sk-live',
      OPENAI_BASE_URL: 'https://chatgpt.com/backend-api/codex',
      OPENAI_MODEL: 'codexplan',
    },
  })

  assert.equal(env.OPENAI_BASE_URL, 'https://api.openai.com/v1')
  assert.equal(env.OPENAI_MODEL, 'gpt-4o')
  assert.equal(env.OPENAI_API_KEY, 'sk-live')
})

test('openai launch ignores codex persisted transport hints', async () => {
  const env = await buildLaunchEnv({
    profile: 'openai',
    persisted: profile('openai', {
      OPENAI_BASE_URL: 'https://chatgpt.com/backend-api/codex',
      OPENAI_MODEL: 'codexplan',
      OPENAI_API_KEY: 'sk-persisted',
    }),
    goal: 'balanced',
    processEnv: {
      OPENAI_API_KEY: 'sk-live',
    },
  })

  assert.equal(env.OPENAI_BASE_URL, 'https://api.openai.com/v1')
  assert.equal(env.OPENAI_MODEL, 'gpt-4o')
  assert.equal(env.OPENAI_API_KEY, 'sk-live')
})

test('matching persisted gemini env is reused for gemini launch', async () => {
  const env = await buildLaunchEnv({
    profile: 'gemini',
    persisted: profile('gemini', {
      GEMINI_MODEL: 'gemini-2.5-flash',
      GEMINI_API_KEY: 'gem-persisted',
      GEMINI_BASE_URL: 'https://example.test/v1beta/openai',
    }),
    goal: 'balanced',
    processEnv: {},
  })

  assert.equal(env.CLAUDE_CODE_USE_GEMINI, '1')
  assert.equal(env.CLAUDE_CODE_USE_OPENAI, undefined)
  assert.equal(env.GEMINI_MODEL, 'gemini-2.5-flash')
  assert.equal(env.GEMINI_API_KEY, 'gem-persisted')
  assert.equal(env.GEMINI_BASE_URL, 'https://example.test/v1beta/openai')
})

test('openai env variables take precedence over gemini', async () => {
  const env = await buildLaunchEnv({
    profile: 'gemini',
    persisted: profile('openai', {
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_API_KEY: 'sk-persisted',
    }),
    goal: 'balanced',
    processEnv: {
      GEMINI_API_KEY: 'gem-live',
      GOOGLE_API_KEY: 'google-live',
      OPENAI_API_KEY: 'sk-live',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-4o-mini',
      CODEX_API_KEY: 'codex-live',
      CHATGPT_ACCOUNT_ID: 'acct_live',
      CLAUDE_CODE_USE_OPENAI: '1',
    },
  })

  assert.equal(env.CLAUDE_CODE_USE_GEMINI, undefined) 
  assert.equal(env.CLAUDE_CODE_USE_OPENAI, '1')
  assert.equal(env.GEMINI_MODEL, undefined)
  assert.equal(env.GEMINI_API_KEY, undefined)
  assert.equal(
    env.GEMINI_BASE_URL,
    undefined,
  )
  assert.equal(env.GOOGLE_API_KEY, undefined)
  assert.equal(env.OPENAI_API_KEY, 'sk-live')
  assert.equal(env.CODEX_API_KEY, undefined)
  assert.equal(env.CHATGPT_ACCOUNT_ID, undefined)
})

test('matching persisted codex env is reused for codex launch', async () => {
  const env = await buildLaunchEnv({
    profile: 'codex',
    persisted: profile('codex', {
      OPENAI_BASE_URL: 'https://chatgpt.com/backend-api/codex',
      OPENAI_MODEL: 'codexspark',
      CODEX_API_KEY: 'codex-persisted',
      CHATGPT_ACCOUNT_ID: 'acct_persisted',
    }),
    goal: 'balanced',
    processEnv: {
      CODEX_AUTH_JSON_PATH: missingCodexAuthPath,
    },
  })

  assert.equal(env.OPENAI_BASE_URL, 'https://chatgpt.com/backend-api/codex')
  assert.equal(env.OPENAI_MODEL, 'codexspark')
  assert.equal(env.CODEX_API_KEY, 'codex-persisted')
  assert.equal(env.CHATGPT_ACCOUNT_ID, 'acct_persisted')
})

test('codex launch normalizes poisoned persisted base urls', async () => {
  const env = await buildLaunchEnv({
    profile: 'codex',
    persisted: profile('codex', {
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'codexspark',
      CHATGPT_ACCOUNT_ID: 'acct_persisted',
    }),
    goal: 'balanced',
    processEnv: {
      CODEX_AUTH_JSON_PATH: missingCodexAuthPath,
    },
  })

  assert.equal(env.OPENAI_BASE_URL, 'https://chatgpt.com/backend-api/codex')
  assert.equal(env.OPENAI_MODEL, 'codexspark')
})

test('codex launch ignores mismatched persisted openai env', async () => {
  const env = await buildLaunchEnv({
    profile: 'codex',
    persisted: profile('openai', {
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_API_KEY: 'sk-persisted',
    }),
    goal: 'balanced',
    processEnv: {
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-4o-mini',
      OPENAI_API_KEY: 'sk-live',
      CODEX_API_KEY: 'codex-live',
      CHATGPT_ACCOUNT_ID: 'acct_live',
    },
  })

  assert.equal(env.OPENAI_BASE_URL, 'https://chatgpt.com/backend-api/codex')
  assert.equal(env.OPENAI_MODEL, 'codexplan')
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.CODEX_API_KEY, 'codex-live')
  assert.equal(env.CHATGPT_ACCOUNT_ID, 'acct_live')
})

test('codex launch ignores placeholder codex env keys', async () => {
  const env = await buildLaunchEnv({
    profile: 'codex',
    persisted: profile('codex', {
      OPENAI_BASE_URL: 'https://chatgpt.com/backend-api/codex',
      OPENAI_MODEL: 'codexspark',
      CODEX_API_KEY: 'codex-persisted',
      CHATGPT_ACCOUNT_ID: 'acct_persisted',
    }),
    goal: 'balanced',
    processEnv: {
      CODEX_API_KEY: 'SUA_CHAVE',
      CODEX_AUTH_JSON_PATH: missingCodexAuthPath,
    },
  })

  assert.equal(env.CODEX_API_KEY, 'codex-persisted')
  assert.equal(env.CHATGPT_ACCOUNT_ID, 'acct_persisted')
})

test('codex launch prefers auth account id over stale persisted value', async () => {
  const codexHome = mkdtempSync(join(tmpdir(), 'openclaude-codex-'))
  try {
    writeFileSync(
      join(codexHome, 'auth.json'),
      JSON.stringify({
        access_token: 'codex-live',
        account_id: 'acct_auth',
      }),
      'utf8',
    )

    const env = await buildLaunchEnv({
      profile: 'codex',
      persisted: profile('codex', {
        OPENAI_BASE_URL: 'https://chatgpt.com/backend-api/codex',
        OPENAI_MODEL: 'codexspark',
        CHATGPT_ACCOUNT_ID: 'acct_persisted',
      }),
      goal: 'balanced',
      processEnv: {
        CODEX_HOME: codexHome,
      },
    })

    assert.equal(env.CHATGPT_ACCOUNT_ID, 'acct_auth')
  } finally {
    rmSync(codexHome, { recursive: true, force: true })
  }
})

test('ollama profiles never persist openai api keys', () => {
  const env = buildOllamaProfileEnv('llama3.1:8b', {
    getOllamaChatBaseUrl: () => 'http://localhost:11434/v1',
  })

  assert.deepEqual(env, {
    OPENAI_BASE_URL: 'http://localhost:11434/v1',
    OPENAI_MODEL: 'llama3.1:8b',
  })
  assert.equal('OPENAI_API_KEY' in env, false)
})

test('codex profiles accept explicit codex credentials', () => {
  const env = buildCodexProfileEnv({
    model: 'codexspark',
    apiKey: 'codex-live',
    processEnv: {
      CHATGPT_ACCOUNT_ID: 'acct_123',
    },
  })

  assert.deepEqual(env, {
    OPENAI_BASE_URL: 'https://chatgpt.com/backend-api/codex',
    OPENAI_MODEL: 'codexspark',
    CODEX_CREDENTIAL_SOURCE: 'existing',
    CODEX_API_KEY: 'codex-live',
    CHATGPT_ACCOUNT_ID: 'acct_123',
  })
})

test('codex profiles require a chatgpt account id', () => {
  const env = buildCodexProfileEnv({
    model: 'codexspark',
    apiKey: 'codex-live',
    processEnv: {
      CODEX_AUTH_JSON_PATH: missingCodexAuthPath,
    },
  })

  assert.equal(env, null)
})

test('gemini profiles accept google api key fallback', () => {
  const env = buildGeminiProfileEnv({
    processEnv: {
      GOOGLE_API_KEY: 'gem-live',
    },
  })

  assert.deepEqual(env, {
    GEMINI_AUTH_MODE: 'api-key',
    GEMINI_MODEL: 'gemini-3-flash-preview',
    GEMINI_API_KEY: 'gem-live',
  })
})

test('gemini profiles use the first model from a semicolon-separated list', () => {
  const env = buildGeminiProfileEnv({
    authMode: 'api-key',
    apiKey: 'gem-live',
    model: 'gemini-2.5-pro; gemini-2.5-flash',
    processEnv: {},
  })

  assert.deepEqual(env, {
    GEMINI_AUTH_MODE: 'api-key',
    GEMINI_MODEL: 'gemini-2.5-pro',
    GEMINI_API_KEY: 'gem-live',
  })
})

test('gemini profiles support access-token auth mode without persisting a key', () => {
  const env = buildGeminiProfileEnv({
    authMode: 'access-token',
    model: 'gemini-2.5-flash',
    processEnv: {},
  })

  assert.deepEqual(env, {
    GEMINI_AUTH_MODE: 'access-token',
    GEMINI_MODEL: 'gemini-2.5-flash',
  })
})

test('gemini profiles support adc auth mode without persisting a key', () => {
  const env = buildGeminiProfileEnv({
    authMode: 'adc',
    model: 'gemini-2.5-flash',
    processEnv: {},
  })

  assert.deepEqual(env, {
    GEMINI_AUTH_MODE: 'adc',
    GEMINI_MODEL: 'gemini-2.5-flash',
  })
})

test('gemini profiles require a key', () => {
  const env = buildGeminiProfileEnv({
    processEnv: {},
  })

  assert.equal(env, null)
})

test('saveProfileFile writes a profile that loadProfileFile can read back', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'openclaude-profile-file-'))

  try {
    const persisted = createProfileFile('openai', {
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-4o',
    })

    const filePath = saveProfileFile(persisted, { cwd })

    assert.equal(filePath, join(cwd, PROFILE_FILE_NAME))
    assert.equal(
      JSON.parse(readFileSync(filePath, 'utf8')).profile,
      'openai',
    )
    assert.deepEqual(loadProfileFile({ cwd }), persisted)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('buildCodexProfileEnv tags OAuth-saved profiles so logout can remove them safely', () => {
  const env = buildCodexProfileEnv({
    model: 'codexplan',
    apiKey: makeJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_oauth',
      },
    }),
    credentialSource: 'oauth',
    processEnv: {},
  })

  assert.deepEqual(env, {
    OPENAI_BASE_URL: DEFAULT_CODEX_BASE_URL,
    OPENAI_MODEL: 'codexplan',
    CODEX_CREDENTIAL_SOURCE: 'oauth',
    CODEX_API_KEY: makeJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_oauth',
      },
    }),
    CHATGPT_ACCOUNT_ID: 'acct_oauth',
  })
})

test('clearPersistedCodexOAuthProfile removes only persisted Codex OAuth profiles', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'openclaude-codex-oauth-profile-'))

  try {
    const providerProfileModule = await import(
      `./providerProfile.js?ts=${Date.now()}-${Math.random()}`
    )
    const {
      PROFILE_FILE_NAME,
      clearPersistedCodexOAuthProfile,
      createProfileFile,
      isPersistedCodexOAuthProfile,
      loadProfileFile,
      saveProfileFile,
    } = providerProfileModule
    const oauthProfile = createProfileFile('codex', {
      OPENAI_MODEL: 'codexplan',
      OPENAI_BASE_URL: DEFAULT_CODEX_BASE_URL,
      CHATGPT_ACCOUNT_ID: 'acct_oauth',
      CODEX_CREDENTIAL_SOURCE: 'oauth',
    })
    saveProfileFile(oauthProfile, { cwd })

    assert.equal(isPersistedCodexOAuthProfile(loadProfileFile({ cwd })), true)
    assert.equal(
      clearPersistedCodexOAuthProfile({ cwd }),
      join(cwd, PROFILE_FILE_NAME),
    )
    assert.equal(loadProfileFile({ cwd }), null)

    const existingCredentialProfile = createProfileFile('codex', {
      OPENAI_MODEL: 'codexplan',
      OPENAI_BASE_URL: DEFAULT_CODEX_BASE_URL,
      CHATGPT_ACCOUNT_ID: 'acct_existing',
      CODEX_CREDENTIAL_SOURCE: 'existing',
    })
    saveProfileFile(existingCredentialProfile, { cwd })

    assert.equal(isPersistedCodexOAuthProfile(loadProfileFile({ cwd })), false)
    assert.equal(clearPersistedCodexOAuthProfile({ cwd }), null)
    assert.deepEqual(loadProfileFile({ cwd }), existingCredentialProfile)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('buildStartupEnvFromProfile applies persisted gemini settings when no provider is explicitly selected', async () => {
  const env = await buildStartupEnvFromProfile({
    persisted: profile('gemini', {
      GEMINI_API_KEY: 'gem-test',
      GEMINI_MODEL: 'gemini-2.5-flash',
    }),
    processEnv: {},
  })

  assert.equal(env.CLAUDE_CODE_USE_GEMINI, '1')
  assert.equal(env.CLAUDE_CODE_USE_OPENAI, undefined)
  assert.equal(env.GEMINI_API_KEY, 'gem-test')
  assert.equal(env.GEMINI_MODEL, 'gemini-2.5-flash')
})

test('buildStartupEnvFromProfile rehydrates stored Gemini access token for access-token profile mode', async () => {
  const env = await buildStartupEnvFromProfile({
    persisted: profile('gemini', {
      GEMINI_AUTH_MODE: 'access-token',
      GEMINI_MODEL: 'gemini-2.5-flash',
    }),
    processEnv: {},
    readGeminiAccessToken: () => 'token-live',
  })

  assert.equal(env.CLAUDE_CODE_USE_GEMINI, '1')
  assert.equal(env.GEMINI_AUTH_MODE, 'access-token')
  assert.equal(env.GEMINI_ACCESS_TOKEN, 'token-live')
  assert.equal(env.GEMINI_API_KEY, undefined)
  assert.equal(env.GEMINI_MODEL, 'gemini-2.5-flash')
})

test('buildStartupEnvFromProfile does not inject stored access token for adc profile mode', async () => {
  const env = await buildStartupEnvFromProfile({
    persisted: profile('gemini', {
      GEMINI_AUTH_MODE: 'adc',
      GEMINI_MODEL: 'gemini-2.5-flash',
    }),
    processEnv: {},
    readGeminiAccessToken: () => 'token-live',
  })

  assert.equal(env.CLAUDE_CODE_USE_GEMINI, '1')
  assert.equal(env.GEMINI_AUTH_MODE, 'adc')
  assert.equal(env.GEMINI_ACCESS_TOKEN, undefined)
  assert.equal(env.GEMINI_API_KEY, undefined)
})

test('buildStartupEnvFromProfile leaves explicit provider selections untouched', async () => {
  const processEnv: NodeJS.ProcessEnv = {
    CLAUDE_CODE_USE_GEMINI: '1',
    GEMINI_API_KEY: 'gem-live',
    GEMINI_MODEL: 'gemini-2.0-flash',
  }

  const env = await buildStartupEnvFromProfile({
    persisted: profile('openai', {
      OPENAI_API_KEY: 'sk-persisted',
      OPENAI_MODEL: 'gpt-4o',
    }),
    processEnv,
  })

  // Remove the strict object equality check: assert.equal(env, processEnv)
  assert.equal(env.CLAUDE_CODE_USE_GEMINI, '1')
  assert.equal(env.GEMINI_API_KEY, 'gem-live')
  assert.equal(env.GEMINI_MODEL, 'gemini-2.0-flash')
  // Add the new default fields injected by the function
  assert.equal(env.GEMINI_BASE_URL, 'https://generativelanguage.googleapis.com/v1beta/openai')
  assert.equal(env.GEMINI_AUTH_MODE, 'api-key')
  assert.equal(env.OPENAI_API_KEY, undefined)
})

test('legacy openai saved profiles still deserialize and rebuild startup env', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))

  try {
    saveProfileFile(
      profile('openai', {
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
        OPENAI_MODEL: 'gpt-4o',
        OPENAI_API_KEY: 'sk-legacy-live',
      }),
      { cwd: tempDir },
    )

    const persisted = loadProfileFile({ cwd: tempDir })
    assert.notEqual(persisted, null)
    assert.equal(persisted?.profile, 'openai')

    const env = await buildStartupEnvFromProfile({
      persisted,
      processEnv: {},
    })

    assert.equal(env.CLAUDE_CODE_USE_OPENAI, '1')
    assert.equal(env.OPENAI_BASE_URL, 'https://api.openai.com/v1')
    assert.equal(env.OPENAI_MODEL, 'gpt-4o')
    assert.equal(env.OPENAI_API_KEY, 'sk-legacy-live')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('legacy anthropic saved profiles still deserialize and rebuild startup env', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))

  try {
    saveProfileFile(
      profile('anthropic', {
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        ANTHROPIC_MODEL: 'claude-sonnet-4-6',
        ANTHROPIC_API_KEY: 'sk-ant-live',
      }),
      { cwd: tempDir },
    )

    const persisted = loadProfileFile({ cwd: tempDir })
    assert.notEqual(persisted, null)
    assert.equal(persisted?.profile, 'anthropic')

    const env = await buildStartupEnvFromProfile({
      persisted,
      processEnv: {},
    })

    assert.equal(env.CLAUDE_CODE_USE_OPENAI, undefined)
    assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.anthropic.com')
    assert.equal(env.ANTHROPIC_MODEL, 'claude-sonnet-4-6')
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-live')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('bedrock persisted profiles load and rebuild the dedicated startup env', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-provider-'))

  try {
    saveProfileFile(
      profile('bedrock', {
        ANTHROPIC_MODEL: 'claude-sonnet-4-6',
        ANTHROPIC_BEDROCK_BASE_URL: 'https://bedrock-proxy.example',
      }),
      { cwd: tempDir },
    )

    const persisted = loadProfileFile({ cwd: tempDir })
    assert.notEqual(persisted, null)
    assert.equal(persisted?.profile, 'bedrock')

    const env = await buildStartupEnvFromProfile({
      persisted,
      processEnv: {},
    })

    assert.equal(env.CLAUDE_CODE_USE_BEDROCK, '1')
    assert.equal(env.ANTHROPIC_MODEL, 'claude-sonnet-4-6')
    assert.equal(
      env.ANTHROPIC_BEDROCK_BASE_URL,
      'https://bedrock-proxy.example',
    )
    assert.equal(env.CLAUDE_CODE_USE_OPENAI, undefined)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('buildStartupEnvFromProfile preserves explicit GitHub provider settings when the legacy file is stale', async () => {
  const processEnv: NodeJS.ProcessEnv = {
    CLAUDE_CODE_USE_GITHUB: '1',
    OPENAI_MODEL: 'github:copilot',
  }

  const env = await buildStartupEnvFromProfile({
    persisted: profile('openai', {
      OPENAI_API_KEY: 'sk-stale',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    }),
    processEnv,
  })

  assert.equal(env, processEnv)
  assert.equal(env.CLAUDE_CODE_USE_GITHUB, '1')
  assert.equal(env.OPENAI_MODEL, 'github:copilot')
  assert.equal(env.CLAUDE_CODE_USE_OPENAI, undefined)
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.OPENAI_BASE_URL, undefined)
})

test('applySavedProfileToCurrentSession can switch away from GitHub provider env', async () => {
  const { applySavedProfileToCurrentSession } = await importFreshProviderProfileModule()
  const processEnv: NodeJS.ProcessEnv = {
    CLAUDE_CODE_USE_GITHUB: '1',
    OPENAI_MODEL: 'github:copilot',
  }

  const error = await applySavedProfileToCurrentSession({
    profileFile: profile('ollama', {
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'llama3.1:8b',
    }),
    processEnv,
  })

  assert.equal(error, null)
  assert.equal(processEnv.CLAUDE_CODE_USE_GITHUB, undefined)
  assert.equal(processEnv.CLAUDE_CODE_USE_OPENAI, '1')
  assert.equal(processEnv.OPENAI_BASE_URL, 'http://localhost:11434/v1')
  assert.equal(processEnv.OPENAI_MODEL, 'llama3.1:8b')
  assert.equal(Object.hasOwn(processEnv, 'OPENAI_API_KEY'), false)
})

test('buildStartupEnvFromProfile preserves plural-profile env when the legacy file is stale', async () => {
  // Regression: a user saves a provider via /provider (plural system).
  // addProviderProfile does NOT sync the legacy .openclaude-profile.json,
  // so the legacy file retains whatever it had from an earlier setup (e.g.
  // OpenAI defaults). At startup, applyActiveProviderProfileFromConfig()
  // correctly applies the active plural profile (Moonshot) first, marking
  // env with CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED=1. The legacy-file
  // load must NOT overwrite that env — it previously did, surfacing as
  // "banner shows the wrong provider / model".
  const processEnv = {
    CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED: '1',
    CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID: 'saved_moonshot',
    CLAUDE_CODE_USE_OPENAI: '1',
    OPENAI_BASE_URL: 'https://api.moonshot.ai/v1',
    OPENAI_MODEL: 'kimi-k2.6',
  }

  const env = await buildStartupEnvFromProfile({
    // Stale legacy file — points at SambaNova, but user's active plural
    // profile is Moonshot and was just applied.
    persisted: profile('openai', {
      OPENAI_API_KEY: 'sk-stale',
      OPENAI_MODEL: 'Meta-Llama-3.1-70B-Instruct',
      OPENAI_BASE_URL: 'https://api.sambanova.ai/v1',
    }),
    processEnv,
  })

  assert.equal(env, processEnv)
  assert.equal(env.OPENAI_BASE_URL, 'https://api.moonshot.ai/v1')
  assert.equal(env.OPENAI_MODEL, 'kimi-k2.6')
  // Plural markers are retained — downstream code uses them to verify the
  // env still belongs to the profile it was applied from.
  assert.equal(env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED, '1')
  assert.equal(env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID, 'saved_moonshot')
})

test('buildStartupEnvFromProfile falls back to legacy file when plural system has not applied', async () => {
  // Counter-example: first-run user with only the legacy file (no plural
  // active profile yet). The legacy file is the correct source, so the
  // load must proceed as before.
  const processEnv = {
    CLAUDE_CODE_USE_OPENAI: '1',
  }

  const env = await buildStartupEnvFromProfile({
    persisted: profile('openai', {
      OPENAI_API_KEY: 'sk-legacy',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    }),
    processEnv,
  })

  assert.notEqual(env, processEnv)
  assert.equal(env.OPENAI_API_KEY, 'sk-legacy')
  assert.equal(env.OPENAI_BASE_URL, 'https://api.openai.com/v1')
  assert.equal(env.OPENAI_MODEL, 'gpt-4o')
})

test('buildStartupEnvFromProfile treats explicit falsey provider flags as user intent', async () => {
  const processEnv = {
    CLAUDE_CODE_USE_OPENAI: '0',
  }

  const env = await buildStartupEnvFromProfile({
    persisted: profile('gemini', {
      GEMINI_API_KEY: 'gem-persisted',
      GEMINI_MODEL: 'gemini-2.5-flash',
    }),
    processEnv,
  })

  assert.equal(env.CLAUDE_CODE_USE_OPENAI, undefined)
  assert.equal(env.CLAUDE_CODE_USE_GEMINI, '1')
  assert.equal(env.GEMINI_API_KEY, 'gem-persisted')
  assert.equal(env.GEMINI_MODEL, 'gemini-2.5-flash')
  assert.equal(env.GEMINI_BASE_URL, 'https://generativelanguage.googleapis.com/v1beta/openai')
  assert.equal(env.GEMINI_AUTH_MODE, 'api-key')
})

test('maskSecretForDisplay preserves only a short prefix and suffix', () => {
  assert.equal(maskSecretForDisplay('sk-secret-12345678'), 'sk-...678')
  assert.equal(maskSecretForDisplay('AIzaSecret12345678'), 'AIz...678')
})

test('redactSecretValueForDisplay masks poisoned display fields that equal configured secrets', () => {
  const apiKey = 'sk-secret-12345678'

  assert.equal(
    redactSecretValueForDisplay(apiKey, { OPENAI_API_KEY: apiKey }),
    'sk-...678',
  )
  assert.equal(
    redactSecretValueForDisplay('gpt-4o', { OPENAI_API_KEY: apiKey }),
    'gpt-4o',
  )
})

test('sanitizeProviderConfigValue drops secret-like poisoned values', () => {
  const apiKey = 'sk-secret-12345678'

  assert.equal(
    sanitizeProviderConfigValue(apiKey, { OPENAI_API_KEY: apiKey }),
    undefined,
  )
  assert.equal(
    sanitizeProviderConfigValue('gpt-4o', { OPENAI_API_KEY: apiKey }),
    'gpt-4o',
  )
})

test('openai profiles ignore codex shell transport hints', () => {
  const env = buildOpenAIProfileEnv({
    goal: 'balanced',
    apiKey: 'sk-live',
    processEnv: {
      OPENAI_BASE_URL: 'https://chatgpt.com/backend-api/codex',
      OPENAI_MODEL: 'codexplan',
      OPENAI_API_KEY: 'sk-live',
    },
  })

  assert.deepEqual(env, {
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    OPENAI_MODEL: 'gpt-4o',
    OPENAI_API_KEY: 'sk-live',
  })
})

test('openai profiles use the first model from a semicolon-separated list', () => {
  const env = buildOpenAIProfileEnv({
    goal: 'balanced',
    apiKey: 'sk-live',
    model: 'gpt-5.4; gpt-5.4-mini',
    processEnv: {},
  })

  assert.deepEqual(env, {
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    OPENAI_MODEL: 'gpt-5.4',
    OPENAI_API_KEY: 'sk-live',
  })
})

test('openai profiles ignore poisoned shell model and base url values', () => {
  const env = buildOpenAIProfileEnv({
    goal: 'balanced',
    apiKey: 'sk-live',
    processEnv: {
      OPENAI_BASE_URL: 'sk-live',
      OPENAI_MODEL: 'sk-live',
      OPENAI_API_KEY: 'sk-live',
    },
  })

  assert.deepEqual(env, {
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    OPENAI_MODEL: 'gpt-4o',
    OPENAI_API_KEY: 'sk-live',
  })
})

test('openai profiles normalize multi-model profile values to the primary model', () => {
  const env = buildOpenAIProfileEnv({
    goal: 'balanced',
    apiKey: 'sk-live',
    model: 'deepseek-v4-flash, deepseek-v4-pro, deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    processEnv: {},
  })

  assert.deepEqual(env, {
    OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
    OPENAI_MODEL: 'deepseek-v4-flash',
    OPENAI_API_KEY: 'sk-live',
  })
})

test('startup env ignores poisoned persisted openai model and base url', async () => {
  const env = await buildStartupEnvFromProfile({
    persisted: profile('openai', {
      OPENAI_API_KEY: 'sk-live',
      OPENAI_MODEL: 'sk-live',
      OPENAI_BASE_URL: 'sk-live',
    }),
    processEnv: {},
  })

  assert.equal(env.CLAUDE_CODE_USE_OPENAI, '1')
  assert.equal(env.OPENAI_API_KEY, 'sk-live')
  assert.equal(env.OPENAI_MODEL, 'gpt-4o')
  assert.equal(env.OPENAI_BASE_URL, 'https://api.openai.com/v1')
})

test('startup env normalizes a semicolon-separated persisted openai model list', async () => {
  const env = await buildStartupEnvFromProfile({
    persisted: profile('openai', {
      OPENAI_API_KEY: 'sk-live',
      OPENAI_MODEL: 'gpt-5.4; gpt-5.4-mini',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    }),
    processEnv: {},
  })

  assert.equal(env.CLAUDE_CODE_USE_OPENAI, '1')
  assert.equal(env.OPENAI_API_KEY, 'sk-live')
  assert.equal(env.OPENAI_MODEL, 'gpt-5.4')
  assert.equal(env.OPENAI_BASE_URL, 'https://api.openai.com/v1')
})

test('auto profile falls back to openai when no viable ollama model exists', () => {
  assert.equal(selectAutoProfile(null), 'openai')
  assert.equal(selectAutoProfile('qwen2.5-coder:7b'), 'ollama')
})

// ── Atomic Chat profile tests ────────────────────────────────────────────────

test('atomic-chat profiles never persist openai api keys', () => {
  const env = buildAtomicChatProfileEnv('some-local-model', {
    getAtomicChatChatBaseUrl: () => 'http://127.0.0.1:1337/v1',
  })

  assert.deepEqual(env, {
    OPENAI_BASE_URL: 'http://127.0.0.1:1337/v1',
    OPENAI_MODEL: 'some-local-model',
  })
  assert.equal('OPENAI_API_KEY' in env, false)
})

test('atomic-chat profiles respect custom base url', () => {
  const env = buildAtomicChatProfileEnv('my-model', {
    baseUrl: 'http://192.168.1.100:1337',
    getAtomicChatChatBaseUrl: (baseUrl?: string) =>
      baseUrl ? `${baseUrl}/v1` : 'http://127.0.0.1:1337/v1',
  })

  assert.equal(env.OPENAI_BASE_URL, 'http://192.168.1.100:1337/v1')
  assert.equal(env.OPENAI_MODEL, 'my-model')
})

test('matching persisted atomic-chat env is reused for atomic-chat launch', async () => {
  const env = await buildLaunchEnv({
    profile: 'atomic-chat',
    persisted: profile('atomic-chat', {
      OPENAI_BASE_URL: 'http://127.0.0.1:1337/v1',
      OPENAI_MODEL: 'llama-3.1-8b',
    }),
    goal: 'balanced',
    processEnv: {},
    getAtomicChatChatBaseUrl: () => 'http://127.0.0.1:1337/v1',
    resolveAtomicChatDefaultModel: async () => 'other-model',
  })

  assert.equal(env.OPENAI_BASE_URL, 'http://127.0.0.1:1337/v1')
  assert.equal(env.OPENAI_MODEL, 'llama-3.1-8b')
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.CODEX_API_KEY, undefined)
})

test('atomic-chat launch ignores mismatched persisted openai env', async () => {
  const env = await buildLaunchEnv({
    profile: 'atomic-chat',
    persisted: profile('openai', {
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_API_KEY: 'sk-persisted',
    }),
    goal: 'balanced',
    processEnv: {
      OPENAI_API_KEY: 'sk-live',
      CODEX_API_KEY: 'codex-live',
      CHATGPT_ACCOUNT_ID: 'acct_live',
    },
    getAtomicChatChatBaseUrl: () => 'http://127.0.0.1:1337/v1',
    resolveAtomicChatDefaultModel: async () => 'local-model',
  })

  assert.equal(env.OPENAI_BASE_URL, 'http://127.0.0.1:1337/v1')
  assert.equal(env.OPENAI_MODEL, 'local-model')
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.CODEX_API_KEY, undefined)
  assert.equal(env.CHATGPT_ACCOUNT_ID, undefined)
})
