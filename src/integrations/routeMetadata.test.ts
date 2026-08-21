import { expect, test } from 'bun:test'

import {
  getRouteCredentialEnvVars,
  getRouteCredentialValue,
  getRouteDefaultBaseUrl,
  getRouteDefaultModel,
  getRouteProviderTypeLabel,
  isApismartBaseUrl,
  isCanonicalApismartInferenceBaseUrl,
  isCanonicalLlmtrInferenceBaseUrl,
  isCloudflareBaseUrl,
  isLlmtrBaseUrl,
  isConcentrateBaseUrl,
  isLongcatBaseUrl,
  resolveActiveRouteIdFromEnv,
  resolveEnvOnlyProviderRouteId,
  resolveRouteCredential,
  resolveRouteCredentialValue,
  resolveRouteIdFromBaseUrl,
} from './routeMetadata.js'
import gatewayLlmtr from './gateways/llmtr.js'
import openAICompatibleAliasModels from './models/openai-compatible-alias.js'
import { ensureIntegrationsLoaded } from './index.js'
import { _clearRegistryForTesting, registerGateway } from './registry.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

test('isCloudflareBaseUrl matches Workers AI host but not the shared AI Gateway', () => {
  // Workers AI lives on api.cloudflare.com.
  expect(
    isCloudflareBaseUrl(
      'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1',
    ),
  ).toBe(true)
  // The shared AI Gateway host proxies arbitrary providers (OpenAI, Anthropic),
  // so a profile pointed there must NOT be treated as Cloudflare-credentialed.
  expect(
    isCloudflareBaseUrl(
      'https://gateway.ai.cloudflare.com/v1/acct/gw/openai',
    ),
  ).toBe(false)
  expect(
    isCloudflareBaseUrl(
      'https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic',
    ),
  ).toBe(false)
  // Lookalike host must not match.
  expect(isCloudflareBaseUrl('https://api.cloudflare.com.evil.test/v1')).toBe(
    false,
  )
  expect(isCloudflareBaseUrl(undefined)).toBe(false)
  // Same host, but a general Cloudflare REST path — NOT Workers AI. Must not
  // match, or it would inherit Workers-AI routing + CLOUDFLARE_API_TOKEN
  // mirroring for an unrelated Cloudflare API call.
  expect(
    isCloudflareBaseUrl(
      'https://api.cloudflare.com/client/v4/user/tokens/verify',
    ),
  ).toBe(false)
  expect(isCloudflareBaseUrl('https://api.cloudflare.com/')).toBe(false)
  // The descriptor's unresolved <ACCOUNT_ID> placeholder is not a real endpoint.
  expect(
    isCloudflareBaseUrl(
      'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1',
    ),
  ).toBe(false)
  // A resolved account id with the OpenAI-compatible suffix still matches.
  expect(
    isCloudflareBaseUrl(
      'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1/chat/completions',
    ),
  ).toBe(true)
  // Workers AI is HTTPS-only. A plaintext http:// endpoint on the same host and
  // path must NOT match, or the Cloudflare route would mirror
  // CLOUDFLARE_API_TOKEN into OPENAI_API_KEY over cleartext.
  expect(
    isCloudflareBaseUrl(
      'http://api.cloudflare.com/client/v4/accounts/abc123/ai/v1',
    ),
  ).toBe(false)
})

test('isLongcatBaseUrl requires the documented HTTPS OpenAI API path', () => {
  expect(isLongcatBaseUrl('https://api.longcat.chat/openai')).toBe(true)
  expect(isLongcatBaseUrl('https://api.longcat.chat/openai/')).toBe(true)
  expect(isLongcatBaseUrl('https://api.longcat.chat/openai/v1')).toBe(true)
  expect(isLongcatBaseUrl('https://api.longcat.chat/openai/v1/chat/completions')).toBe(true)
  expect(isLongcatBaseUrl('https://api.longcat.chat/openai/chat/completions')).toBe(true)
  expect(isLongcatBaseUrl('https://api.longcat.chat/openai/other')).toBe(false)
  expect(isLongcatBaseUrl('https://api.longcat.chat/openai/v1?query=value')).toBe(false)
  expect(isLongcatBaseUrl('https://api.longcat.chat/openai/v1#fragment')).toBe(false)
  expect(isLongcatBaseUrl('https://api.longcat.chat:8443/openai/v1')).toBe(false)
  expect(isLongcatBaseUrl('http://api.longcat.chat/openai/v1')).toBe(false)
  expect(isLongcatBaseUrl('https://api.longcat.chat/v1')).toBe(false)
  expect(isLongcatBaseUrl('https://api.longcat.chat.evil.test/openai/v1')).toBe(false)
})

test('resolveActiveRouteIdFromEnv keeps generic OpenAI credentials ahead of env-only LongCat', () => {
  expect(resolveActiveRouteIdFromEnv({
    OPENAI_API_KEY: 'generic-key',
    LONGCAT_API_KEY: 'longcat-key',
  })).not.toBe('longcat')
})

test('isLlmtrBaseUrl matches the exact llmtr.com host, not substring or subdomain', () => {
  expect(isLlmtrBaseUrl('https://llmtr.com/v1')).toBe(true)
  // Exact-host only, aligned with the descriptor's matchBaseUrlHosts: subdomains
  // are not routed as LLMTR, so they must not be treated as LLMTR here either.
  expect(isLlmtrBaseUrl('https://api.llmtr.com/v1')).toBe(false)
  // Lookalike hosts that a substring check would wrongly accept.
  expect(isLlmtrBaseUrl('https://not-llmtr.com/v1')).toBe(false)
  expect(isLlmtrBaseUrl('https://llmtr.com.evil.example/v1')).toBe(false)
  expect(isLlmtrBaseUrl('https://api.openai.com/v1')).toBe(false)
  expect(isLlmtrBaseUrl(undefined)).toBe(false)
  expect(isLlmtrBaseUrl('not a url')).toBe(false)
})

test('isCanonicalLlmtrInferenceBaseUrl gates the dedicated key on the real endpoint', () => {
  expect(isCanonicalLlmtrInferenceBaseUrl('https://llmtr.com/v1')).toBe(true)
  expect(isCanonicalLlmtrInferenceBaseUrl('https://llmtr.com/v1/')).toBe(true)
  // An explicit default port is the same endpoint, so rejecting it would be a
  // false positive — URL parsing normalises it away.
  expect(isCanonicalLlmtrInferenceBaseUrl('https://llmtr.com:443/v1')).toBe(true)
  expect(isCanonicalLlmtrInferenceBaseUrl('https://LLMTR.COM/v1')).toBe(true)

  // The OpenAI shim appends `/chat/completions`, so the bare host and arbitrary
  // paths are not interchangeable with the documented `/v1` API base.
  expect(isCanonicalLlmtrInferenceBaseUrl('https://llmtr.com')).toBe(false)
  expect(isCanonicalLlmtrInferenceBaseUrl('https://llmtr.com/')).toBe(false)
  expect(isCanonicalLlmtrInferenceBaseUrl('https://llmtr.com/anything')).toBe(false)
  expect(isCanonicalLlmtrInferenceBaseUrl('https://llmtr.com/v1?query=value')).toBe(false)
  expect(isCanonicalLlmtrInferenceBaseUrl('https://llmtr.com/v1#fragment')).toBe(false)
  // URL.origin deliberately omits userinfo, but passing it through would add
  // credentials unrelated to LLMTR_API_KEY to the outbound request URL.
  expect(isCanonicalLlmtrInferenceBaseUrl('https://user@llmtr.com/v1')).toBe(false)
  expect(isCanonicalLlmtrInferenceBaseUrl('https://:password@llmtr.com/v1')).toBe(false)
  expect(isCanonicalLlmtrInferenceBaseUrl('https://user:password@llmtr.com/v1')).toBe(false)

  // Plaintext would put LLMTR_API_KEY on the wire unencrypted.
  expect(isCanonicalLlmtrInferenceBaseUrl('http://llmtr.com/v1')).toBe(false)
  // A non-default port is a different service that only shares the hostname.
  expect(isCanonicalLlmtrInferenceBaseUrl('https://llmtr.com:8443/v1')).toBe(false)
  // Everything the host-scoped predicate already rejects stays rejected.
  expect(isCanonicalLlmtrInferenceBaseUrl('https://not-llmtr.com/v1')).toBe(false)
  expect(isCanonicalLlmtrInferenceBaseUrl('https://api.llmtr.com/v1')).toBe(false)
  expect(isCanonicalLlmtrInferenceBaseUrl(undefined)).toBe(false)
  expect(isCanonicalLlmtrInferenceBaseUrl('not a url')).toBe(false)
})

test('llmtr seed catalog covers passthrough routes and drops retired model ids', () => {
  const apiNames = (gatewayLlmtr.catalog?.models ?? []).map(
    model => model.apiName ?? model.id,
  )

  // LLMTR is a multi-vendor gateway: the seed catalog must not look
  // Turkey-only, or the picker misrepresents what the key actually buys.
  const turkeyHosted = apiNames.filter(name => name.startsWith('llmtr/'))
  const passthrough = apiNames.filter(name => !name.startsWith('llmtr/'))
  expect(turkeyHosted.length).toBeGreaterThan(0)
  expect(passthrough.length).toBeGreaterThan(turkeyHosted.length)

  // Retired/aliased ids: llmtr/sincap was withdrawn and llmtr/trendyol-7b is
  // only a migration alias, so neither may be advertised.
  expect(apiNames).not.toContain('llmtr/sincap')
  expect(apiNames).not.toContain('llmtr/trendyol-7b')
  // These chat endpoints do not accept tools, so they cannot serve an
  // OpenClaude coding-agent session and must not be offered by the route.
  expect(apiNames).not.toContain('llmtr/trendyol-asure-12b')
  expect(apiNames).not.toContain('llmtr/magibu-11b-v8')
  const aliasIds = openAICompatibleAliasModels.map(model => model.id)
  expect(aliasIds).not.toContain('llmtr/trendyol-asure-12b')
  expect(aliasIds).not.toContain('llmtr/magibu-11b-v8')

  // The default must be a route the catalog actually offers.
  expect(gatewayLlmtr.defaultModel).toBeDefined()
  expect(apiNames).toContain(String(gatewayLlmtr.defaultModel))
})

test('llmtr seed catalog aliases every descriptor id that differs from the wire name', () => {
  // profileSupportsModel matches apiName / catalog id / aliases — never
  // modelDescriptorId. Without the alias a `/model` pick made by descriptor id
  // fails to match on relaunch and the saved selection is dropped.
  for (const model of gatewayLlmtr.catalog?.models ?? []) {
    const descriptorId = model.modelDescriptorId
    if (!descriptorId || descriptorId === model.apiName) {
      continue
    }
    expect(model.aliases ?? []).toContain(descriptorId)
  }
})

test('getRouteProviderTypeLabel uses descriptor transport kinds for provider labels', () => {
  expect(getRouteProviderTypeLabel('anthropic')).toBe('Anthropic native API')
  expect(getRouteProviderTypeLabel('gemini')).toBe('Gemini API')
  expect(getRouteProviderTypeLabel('bedrock')).toBe(
    'AWS Bedrock Claude API',
  )
  expect(getRouteProviderTypeLabel('vertex')).toBe(
    'Google Vertex Claude API',
  )
  expect(getRouteProviderTypeLabel('openrouter')).toBe(
    'OpenAI-compatible API',
  )
  expect(getRouteProviderTypeLabel('ollama')).toBe('OpenAI-compatible API')
})

test('getRouteProviderTypeLabel falls back safely for unknown routes', () => {
  expect(getRouteProviderTypeLabel('missing-route')).toBe(
    'OpenAI-compatible API',
  )
})

test('getRouteCredentialEnvVars keeps descriptor env vars and openai fallback for openai-compatible routes', () => {
  expect(getRouteCredentialEnvVars('custom')).toEqual([
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('openrouter')).toEqual([
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('deepseek')).toEqual([
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('hicap')).toEqual([
    'HICAP_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('aimlapi')).toEqual([
    'AIMLAPI_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('venice')).toEqual([
    'VENICE_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(getRouteCredentialEnvVars('xiaomi-mimo')).toEqual([
    'MIMO_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
})

test('custom Anthropic credentials stay native and resolve to their proxy route', () => {
  expect(getRouteCredentialEnvVars('custom-anthropic')).toEqual([
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_API_KEY',
  ])
  expect(
    resolveActiveRouteIdFromEnv({
      ANTHROPIC_BASE_URL: 'https://tenant.example/v1',
      ANTHROPIC_MODEL: 'tenant-model',
      ANTHROPIC_AUTH_TOKEN: 'tenant-token',
    }),
  ).toBe('custom-anthropic')

  expect(
    resolveActiveRouteIdFromEnv({
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_AUTH_TOKEN: 'first-party-token',
    }),
  ).toBe('anthropic')

  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_API_KEY: 'openai-key',
      ANTHROPIC_BASE_URL: 'https://tenant.example/v1',
      ANTHROPIC_MODEL: 'tenant-model',
      ANTHROPIC_AUTH_TOKEN: 'tenant-token',
    }),
  ).toBe('openai')

  expect(
    resolveActiveRouteIdFromEnv({
      ANTHROPIC_BASE_URL: 'https://tenant.example/v1',
      ANTHROPIC_MODEL: 'tenant-model',
      ANTHROPIC_API_KEY: 'tenant-key',
    }),
  ).toBe('custom-anthropic')

  expect(
    resolveActiveRouteIdFromEnv({
      ANTHROPIC_BASE_URL: 'https://tenant.example/v1',
      ANTHROPIC_MODEL: 'tenant-model',
      ANTHROPIC_API_KEY: 'tenant-key',
      MINIMAX_API_KEY: 'ambient-minimax-key',
    }),
  ).toBe('custom-anthropic')

  expect(
    resolveActiveRouteIdFromEnv({
      ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
      ANTHROPIC_MODEL: 'tenant-model',
      ANTHROPIC_AUTH_TOKEN: 'tenant-token',
    }),
  ).toBe('custom-anthropic')
})

test('getRouteCredentialEnvVars omits the openai fallback for dedicatedCredentialsOnly routes', () => {
  expect(getRouteCredentialEnvVars('atlas-cloud')).toEqual([
    'ATLAS_CLOUD_API_KEY',
  ])
  expect(
    getRouteCredentialValue('atlas-cloud', {
      OPENAI_API_KEY: 'sk-openai-generic',
    }),
  ).toBeUndefined()
  expect(
    getRouteCredentialValue('atlas-cloud', {
      OPENAI_API_KEY: 'sk-openai-generic',
      ATLAS_CLOUD_API_KEY: 'atlas-key',
    }),
  ).toBe('atlas-key')
  expect(getRouteCredentialEnvVars('apismart')).toEqual(['APISMART_API_KEY'])
  expect(
    getRouteCredentialValue('apismart', {
      OPENAI_API_KEY: 'sk-openai-generic',
    }),
  ).toBeUndefined()
  expect(
    getRouteCredentialValue('apismart', {
      OPENAI_API_KEY: 'sk-openai-generic',
      APISMART_API_KEY: 'apismart-key',
    }),
  ).toBe('apismart-key')
})

test('getRouteCredentialValue reads the first configured route credential', () => {
  expect(
    getRouteCredentialValue('openrouter', {
      OPENROUTER_API_KEY: 'or-key',
    }),
  ).toBe('or-key')
  expect(
    getRouteCredentialValue('deepseek', {
      OPENAI_API_KEY: 'sk-openai-fallback',
    }),
  ).toBe('sk-openai-fallback')
})

test('route credential discovery reads OPENAI_API_KEYS before singular fallback', () => {
  expect(
    getRouteCredentialValue('openai', {
      OPENAI_API_KEYS: 'sk-openai-a,sk-openai-b',
      OPENAI_API_KEY: 'sk-openai-single',
    }),
  ).toBe('sk-openai-a,sk-openai-b')
  expect(
    resolveRouteCredentialValue({
      baseUrl: 'https://api.openai.com/v1',
      processEnv: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_KEYS: 'sk-openai-a,sk-openai-b',
      },
    }),
  ).toBe('sk-openai-a,sk-openai-b')
})

test('route credential discovery ignores delimiter-only OPENAI_API_KEYS before singular fallback', () => {
  expect(
    getRouteCredentialValue('openai', {
      OPENAI_API_KEYS: ', ,',
      OPENAI_API_KEY: 'sk-openai-single',
    }),
  ).toBe('sk-openai-single')
})

test('route credential discovery ignores placeholder OpenAI credentials', () => {
  expect(
    getRouteCredentialValue('openai', {
      OPENAI_API_KEYS: 'SUA_CHAVE',
      OPENAI_API_KEY: 'sk-openai-single',
    }),
  ).toBe('sk-openai-single')
  expect(
    resolveRouteCredentialValue({
      baseUrl: 'https://api.openai.com/v1',
      processEnv: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_KEYS: 'SUA_CHAVE',
        OPENAI_API_KEY: 'SUA_CHAVE',
      },
    }),
  ).toBeUndefined()
})

test('route credential discovery ignores mixed placeholder OpenAI pools before singular fallback', () => {
  expect(
    getRouteCredentialValue('openai', {
      OPENAI_API_KEYS: 'sk-openai-a,SUA_CHAVE',
      OPENAI_API_KEY: 'sk-openai-single',
    }),
  ).toBe('sk-openai-single')
})

test('ApiSmart dedicated credential is limited to the canonical inference base URL', () => {
  const processEnv = { APISMART_API_KEY: 'apismart-secret' }

  expect(
    resolveRouteCredentialValue({
      routeId: 'apismart',
      baseUrl: 'https://gw.apismart.ai/v1',
      processEnv,
    }),
  ).toBe('apismart-secret')
  expect(
    resolveRouteCredentialValue({
      routeId: 'apismart',
      baseUrl: 'https://gw.apismart.ai/v1/models',
      processEnv,
    }),
  ).toBeUndefined()
  expect(
    resolveRouteCredentialValue({
      routeId: 'apismart',
      baseUrl: 'https://gw.apismart.ai/v2',
      processEnv,
    }),
  ).toBeUndefined()
})

test('LLMTR dedicated credential is limited to the canonical inference base', () => {
  const processEnv = { LLMTR_API_KEY: 'llmtr-secret' }

  // Canonical: documented `/v1` API base, with an explicit default port and
  // case-insensitively on the host.
  for (const baseUrl of [
    'https://llmtr.com/v1',
    'https://llmtr.com/v1/',
    'https://llmtr.com:443/v1',
    'https://LLMTR.COM/v1',
  ]) {
    expect(
      resolveRouteCredentialValue({ routeId: 'llmtr', baseUrl, processEnv }),
    ).toBe('llmtr-secret')
  }

  // Non-canonical: plaintext puts the key on the wire unencrypted, a non-default
  // port is a different service on the same hostname, and a proxy host is not
  // LLMTR at all.
  for (const baseUrl of [
    'http://llmtr.com/v1',
    'https://llmtr.com:8443/v1',
    'https://llmtr.com',
    'https://llmtr.com/anything',
    'https://llmtr.com/v1?query=value',
    'https://user:password@llmtr.com/v1',
    'https://proxy.example/v1',
  ]) {
    expect(
      resolveRouteCredentialValue({ routeId: 'llmtr', baseUrl, processEnv }),
    ).toBeUndefined()
  }

  // No base URL at all resolves to the LLMTR default, which is canonical.
  expect(
    resolveRouteCredentialValue({ routeId: 'llmtr', processEnv }),
  ).toBe('llmtr-secret')
  expect(
    resolveRouteCredential({
      routeId: 'llmtr',
      baseUrl: 'https://llmtr.com/v1',
      processEnv,
    }),
  ).toEqual({ sourceEnvVar: 'LLMTR_API_KEY', value: 'llmtr-secret' })
})

test.each([
  ['openai', 'https://api.openai.com/v1'],
  ['anthropic', undefined],
] as const)(
  'pinned %s selection outranks an ambient LLMTR env-only signal',
  (routeId, baseUrl) => {
    expect(
      resolveActiveRouteIdFromEnv({
        CLAUDE_CODE_PROVIDER_ROUTE_ID: routeId,
        CLAUDE_CODE_USE_OPENAI: routeId === 'openai' ? '1' : undefined,
        OPENAI_BASE_URL: baseUrl,
        LLMTR_API_KEY: 'ambient-llmtr-key',
      }),
    ).toBe(routeId)
  },
)

test('rejects a stale OpenAI route marker when Gemini is the current mode', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_PROVIDER_ROUTE_ID: 'openai',
      CLAUDE_CODE_USE_GEMINI: '1',
      GEMINI_API_KEY: 'gemini-key',
    }),
  ).toBe('gemini')
})

test('a valid pinned selection suppresses direct env-only inference', () => {
  expect(
    resolveEnvOnlyProviderRouteId({
      CLAUDE_CODE_PROVIDER_ROUTE_ID: 'openai',
      CLAUDE_CODE_USE_OPENAI: '1',
      LLMTR_API_KEY: 'ambient-llmtr-key',
      CONCENTRATE_API_KEY: 'ambient-concentrate-key',
    }),
  ).toBeNull()
})

test('pinned retargeted LLMTR profile still resolves as custom', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_PROVIDER_ROUTE_ID: 'llmtr',
      CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED: '1',
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://proxy.example/v1',
      LLMTR_API_KEY: 'ambient-llmtr-key',
    }),
  ).toBe('custom')
})

test('resolveActiveRouteIdFromEnv does not retain LLMTR identity for a retargeted profile', () => {
  const baseUrl = 'https://proxy.example/v1'
  expect(
    resolveActiveRouteIdFromEnv(
      { CLAUDE_CODE_USE_OPENAI: '1', OPENAI_BASE_URL: baseUrl },
      { activeProfileProvider: 'llmtr', activeProfileBaseUrl: baseUrl },
    ),
  ).toBe('custom')
})

test('resolveActiveRouteIdFromEnv recognises env-only LLMTR from the dedicated key', () => {
  // Without this, exporting LLMTR_API_KEY and running the CLI resolved to the
  // default gateway rather than LLMTR: the key was set but never used.
  expect(resolveActiveRouteIdFromEnv({ LLMTR_API_KEY: 'llmtr-key' })).toBe('llmtr')
})

test('env-only LLMTR yields to an explicitly configured OpenAI-compatible endpoint', () => {
  // A dedicated key must not claim the route when the operator has already
  // pointed OPENAI_BASE_URL somewhere else — the key would follow that URL.
  expect(
    resolveActiveRouteIdFromEnv({
      LLMTR_API_KEY: 'llmtr-key',
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://proxy.example/v1',
    }),
  ).toBe('custom')
})

test('env-only LLMTR still resolves when OPENAI_BASE_URL targets llmtr.com', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      LLMTR_API_KEY: 'llmtr-key',
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://llmtr.com/v1',
    }),
  ).toBe('llmtr')
})

test('env-only LLMTR honors an explicit OpenAI-compatible opt-out', () => {
  const processEnv = {
    CLAUDE_CODE_USE_OPENAI: '0',
    LLMTR_API_KEY: 'llmtr-key',
  }

  expect(resolveEnvOnlyProviderRouteId(processEnv)).toBeNull()
  expect(resolveActiveRouteIdFromEnv(processEnv)).not.toBe('llmtr')
})

test('env-only LLMTR does not claim non-canonical URLs on its own host', () => {
  // Plaintext and off-port llmtr.com URLs must not select the dedicated route.
  // If they did, applyLlmtrEnvOnlyDefaults would then withhold the key for being
  // non-canonical and strand the session on the LLMTR route with no credential.
  // This also keeps the env-only path in step with resolveRouteIdFromBaseUrl,
  // which already sends these URLs to `custom`.
  for (const baseUrl of ['http://llmtr.com/v1', 'https://llmtr.com:8443/v1']) {
    expect(
      resolveActiveRouteIdFromEnv({
        LLMTR_API_KEY: 'llmtr-key',
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: baseUrl,
      }),
    ).toBe('custom')
  }
})

test('an explicit non-OpenAI provider outranks an ambient LLMTR key', () => {
  // ApiSmart parity: a Gemini/Bedrock/Vertex selection is an explicit choice and
  // must not be overridden by a leftover dedicated key.
  expect(
    resolveActiveRouteIdFromEnv({
      LLMTR_API_KEY: 'llmtr-key',
      CLAUDE_CODE_USE_GEMINI: '1',
    }),
  ).toBe('gemini')
})

test('resolveActiveRouteIdFromEnv keeps LLMTR identity on the canonical endpoint', () => {
  const baseUrl = 'https://llmtr.com/v1'
  expect(
    resolveActiveRouteIdFromEnv(
      { CLAUDE_CODE_USE_OPENAI: '1', OPENAI_BASE_URL: baseUrl },
      { activeProfileProvider: 'llmtr', activeProfileBaseUrl: baseUrl },
    ),
  ).toBe('llmtr')
})

test('resolveRouteIdFromBaseUrl rejects non-canonical llmtr.com endpoints', () => {
  // The route stays host-scoped for descriptor agreement, so the endpoint
  // boundary lives here: an env-only plaintext or off-port URL becomes a
  // generic custom endpoint rather than a dedicated route with a withheld key.
  expect(resolveRouteIdFromBaseUrl('https://llmtr.com/v1')).toBe('llmtr')
  expect(resolveRouteIdFromBaseUrl('https://llmtr.com/v1/')).toBe('llmtr')
  expect(resolveRouteIdFromBaseUrl('https://llmtr.com')).toBe(null)
  expect(resolveRouteIdFromBaseUrl('https://llmtr.com/anything')).toBe(null)
  expect(resolveRouteIdFromBaseUrl('http://llmtr.com/v1')).toBe(null)
  expect(resolveRouteIdFromBaseUrl('https://llmtr.com:8443/v1')).toBe(null)
})

test('Venice route metadata uses official OpenAI-compatible defaults', () => {
  expect(getRouteDefaultBaseUrl('venice')).toBe('https://api.venice.ai/api/v1')
  expect(getRouteDefaultModel('venice')).toBe('venice-uncensored')
  expect(resolveRouteIdFromBaseUrl('https://api.venice.ai/api/v1')).toBe('venice')
  expect(resolveRouteIdFromBaseUrl('https://api.venice.ai/api/v1/chat/completions')).toBe('venice')
})

test('AI/ML API route metadata uses official OpenAI-compatible defaults', () => {
  expect(getRouteDefaultBaseUrl('aimlapi')).toBe('https://api.aimlapi.com/v1')
  expect(getRouteDefaultModel('aimlapi')).toBe('gpt-4o')
  expect(resolveRouteIdFromBaseUrl('https://api.aimlapi.com/v1')).toBe('aimlapi')
  expect(resolveRouteIdFromBaseUrl('https://api.aimlapi.com/v1/chat/completions')).toBe('aimlapi')
})

test('ApiSmart route metadata uses official OpenAI-compatible defaults', () => {
  expect(getRouteDefaultBaseUrl('apismart')).toBe('https://gw.apismart.ai/v1')
  expect(getRouteDefaultModel('apismart')).toBe('DEEPSEEK_V4_FLASH')
  expect(resolveRouteIdFromBaseUrl('https://gw.apismart.ai/v1')).toBe('apismart')
  expect(resolveRouteIdFromBaseUrl('https://gw.apismart.ai/v1/chat/completions')).toBe(
    'apismart',
  )
})

test('isApismartBaseUrl requires the documented HTTPS endpoint', () => {
  expect(isApismartBaseUrl('https://gw.apismart.ai/v1')).toBe(true)
  expect(isApismartBaseUrl('http://gw.apismart.ai/v1')).toBe(false)
  expect(isApismartBaseUrl('https://gw.apismart.ai:8443/v1')).toBe(false)
  expect(resolveRouteIdFromBaseUrl('http://gw.apismart.ai/v1')).toBe(null)
  expect(resolveRouteIdFromBaseUrl('https://gw.apismart.ai:8443/v1')).toBe(null)
})

test('isCanonicalApismartInferenceBaseUrl requires the exact /v1 inference path', () => {
  expect(isCanonicalApismartInferenceBaseUrl('https://gw.apismart.ai/v1')).toBe(
    true,
  )
  expect(isCanonicalApismartInferenceBaseUrl('https://gw.apismart.ai/v1/')).toBe(
    true,
  )
  expect(isCanonicalApismartInferenceBaseUrl('https://gw.apismart.ai/v1?x=1')).toBe(
    false,
  )
  expect(isCanonicalApismartInferenceBaseUrl('https://gw.apismart.ai/v1#fragment')).toBe(
    false,
  )
  expect(isCanonicalApismartInferenceBaseUrl('https://gw.apismart.ai')).toBe(
    false,
  )
  expect(
    isCanonicalApismartInferenceBaseUrl('https://gw.apismart.ai/v1/models'),
  ).toBe(false)
  expect(
    isCanonicalApismartInferenceBaseUrl('https://gw.apismart.ai/staging/v1'),
  ).toBe(false)
  expect(isCanonicalApismartInferenceBaseUrl('https://gw.apismart.ai/v2')).toBe(
    false,
  )
  // Host-scoped route match still accepts path suffixes for identity.
  expect(isApismartBaseUrl('https://gw.apismart.ai/v1/models')).toBe(true)
  expect(isApismartBaseUrl('https://gw.apismart.ai')).toBe(true)
})

test('AI/ML API route credential discovery ignores placeholder dedicated key', () => {
  expect(
    resolveRouteCredentialValue({
      routeId: 'aimlapi',
      processEnv: {
        AIMLAPI_API_KEY: 'SUA_CHAVE',
        OPENAI_API_KEY: 'sk-openai-fallback',
      },
    }),
  ).toBe('sk-openai-fallback')
})

test('Cloudflare Workers AI route only matches api.cloudflare.com, not the shared AI Gateway host (#1100)', () => {
  // api.cloudflare.com is the Workers AI host — direct match is fine.
  expect(
    resolveRouteIdFromBaseUrl(
      'https://api.cloudflare.com/client/v4/accounts/acc-123/ai/v1',
    ),
  ).toBe('cloudflare')
  // gateway.ai.cloudflare.com is the shared host for all AI Gateway routes
  // (Workers AI, Anthropic, OpenAI, etc.). Matching here would apply
  // Workers-AI runtime metadata + credential precedence to other providers'
  // Gateway URLs, so the route MUST NOT claim it. Falls back to custom/
  // OpenAI-compatible (null) per resolveRouteIdFromBaseUrl semantics.
  expect(
    resolveRouteIdFromBaseUrl(
      'https://gateway.ai.cloudflare.com/v1/acc-123/my-gw/anthropic',
    ),
  ).toBe(null)
  expect(
    resolveRouteIdFromBaseUrl(
      'https://gateway.ai.cloudflare.com/v1/acc-123/my-gw/openai',
    ),
  ).toBe(null)
  // Same-host general REST path is not the Workers AI route.
  expect(
    resolveRouteIdFromBaseUrl(
      'https://api.cloudflare.com/client/v4/user/tokens/verify',
    ),
  ).toBe(null)
})

test('resolveActiveRouteIdFromEnv does not claim cloudflare for a retargeted cloudflare profile (#1100)', () => {
  // A saved `cloudflare` profile pointed at a non-Workers URL must fall back to
  // generic openai/custom, not resolve as cloudflare via the profile-provider
  // shortcut — otherwise the Workers AI shim config + CLOUDFLARE_API_TOKEN
  // mirroring would be applied to the shared AI Gateway host or a general REST
  // path.
  // Falls back to the generic OpenAI-compatible `custom` route (not just
  // "anything but cloudflare"), so the assertion also pins the intended target.
  const gatewayUrl = 'https://gateway.ai.cloudflare.com/v1/abc/gw/openai'
  expect(
    resolveActiveRouteIdFromEnv(
      { CLAUDE_CODE_USE_OPENAI: '1', OPENAI_BASE_URL: gatewayUrl },
      { activeProfileProvider: 'cloudflare', activeProfileBaseUrl: gatewayUrl },
    ),
  ).toBe('custom')

  const restUrl = 'https://api.cloudflare.com/client/v4/user/tokens/verify'
  expect(
    resolveActiveRouteIdFromEnv(
      { CLAUDE_CODE_USE_OPENAI: '1', OPENAI_BASE_URL: restUrl },
      { activeProfileProvider: 'cloudflare', activeProfileBaseUrl: restUrl },
    ),
  ).toBe('custom')
})

test('resolveActiveRouteIdFromEnv still resolves cloudflare for a real Workers AI profile (#1100)', () => {
  // With the env base URL unset, the profile-provider fallback runs; a genuine
  // Workers AI profile base URL must still resolve as cloudflare.
  const workersUrl =
    'https://api.cloudflare.com/client/v4/accounts/real123/ai/v1'
  expect(
    resolveActiveRouteIdFromEnv(
      { CLAUDE_CODE_USE_OPENAI: '1' },
      {
        activeProfileProvider: 'cloudflare',
        activeProfileBaseUrl: workersUrl,
      },
    ),
  ).toBe('cloudflare')
})

test('Xiaomi MiMo route metadata uses official OpenAI-compatible defaults', () => {
  expect(getRouteDefaultBaseUrl('xiaomi-mimo')).toBe('https://api.xiaomimimo.com/v1')
  expect(getRouteDefaultModel('xiaomi-mimo')).toBe('mimo-v2.5-pro')
  expect(resolveRouteIdFromBaseUrl('https://api.xiaomimimo.com/v1')).toBe('xiaomi-mimo')
  expect(resolveRouteIdFromBaseUrl('https://api.xiaomimimo.com/v1/chat/completions')).toBe('xiaomi-mimo')
  expect(resolveRouteIdFromBaseUrl('https://api.mimo-v2.com/v1')).toBe('xiaomi-mimo')
})

test('resolveActiveRouteIdFromEnv treats Xiaomi MiMo credential-only env as Xiaomi MiMo', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MIMO_API_KEY: 'mimo-key',
    }),
  ).toBe('xiaomi-mimo')
})

test('resolveActiveRouteIdFromEnv treats MiniMax credential-only env as MiniMax', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MINIMAX_API_KEY: 'minimax-key',
    }),
  ).toBe('minimax')
})

test('resolveActiveRouteIdFromEnv treats Anthropic-compatible MiniMax profile env as MiniMax', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
      ANTHROPIC_API_KEY: 'minimax-key',
      ANTHROPIC_MODEL: 'MiniMax-M2.7',
    }),
  ).toBe('minimax')
})

test('resolveActiveRouteIdFromEnv treats Venice credential-only env as Venice', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      VENICE_API_KEY: 'venice-key',
    }),
  ).toBe('venice')
})

test('resolveActiveRouteIdFromEnv treats AI/ML API credential-only env as AI/ML API', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      AIMLAPI_API_KEY: 'aimlapi-key',
    }),
  ).toBe('aimlapi')
})

test('resolveActiveRouteIdFromEnv treats ApiSmart credential-only env as ApiSmart', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      APISMART_API_KEY: 'apismart-key',
    }),
  ).toBe('apismart')
})

test('resolveActiveRouteIdFromEnv ignores placeholder ApiSmart credentials', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      APISMART_API_KEY: 'SUA_CHAVE',
    }),
  ).not.toBe('apismart')
  expect(
    resolveActiveRouteIdFromEnv({
      APISMART_API_KEY: 'null',
    }),
  ).not.toBe('apismart')
  expect(
    resolveActiveRouteIdFromEnv({
      APISMART_API_KEY: 'undefined',
    }),
  ).not.toBe('apismart')
  expect(
    resolveActiveRouteIdFromEnv({
      APISMART_API_KEY: 'sua_chave',
      AIMLAPI_API_KEY: 'aimlapi-key',
    }),
  ).toBe('aimlapi')
  expect(
    resolveActiveRouteIdFromEnv({
      APISMART_API_KEY: 'null',
      AIMLAPI_API_KEY: 'aimlapi-key',
    }),
  ).toBe('aimlapi')
  expect(
    resolveActiveRouteIdFromEnv({
      APISMART_API_KEY: 'SUA_CHAVE',
      AIMLAPI_API_KEY: 'aimlapi-key',
    }),
  ).toBe('aimlapi')
  expect(
    resolveRouteCredentialValue({
      routeId: 'apismart',
      processEnv: { APISMART_API_KEY: 'SUA_CHAVE' },
    }),
  ).toBeUndefined()
  expect(
    resolveRouteCredentialValue({
      routeId: 'apismart',
      processEnv: { APISMART_API_KEY: 'null' },
    }),
  ).toBeUndefined()
})

test('resolveActiveRouteIdFromEnv prefers ApiSmart over ClinePass when both dedicated keys are set', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      APISMART_API_KEY: 'apismart-key',
      CLINE_API_KEY: 'cline-key',
    }),
  ).toBe('apismart')
})

test('resolveActiveRouteIdFromEnv prefers ApiSmart over AI/ML API when both dedicated keys are set', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      APISMART_API_KEY: 'apismart-key',
      AIMLAPI_API_KEY: 'aimlapi-key',
    }),
  ).toBe('apismart')
})

test('resolveActiveRouteIdFromEnv refines generic OpenAI profile by ApiSmart base URL', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'sk-openai-generic',
      OPENAI_BASE_URL: 'https://gw.apismart.ai/v1',
    }),
  ).toBe('apismart')
})

test('resolveActiveRouteIdFromEnv does not retain ApiSmart identity for a retargeted profile', () => {
  const baseUrl = 'https://proxy.example/v1'
  expect(
    resolveActiveRouteIdFromEnv(
      { CLAUDE_CODE_USE_OPENAI: '1', OPENAI_BASE_URL: baseUrl },
      { activeProfileProvider: 'apismart', activeProfileBaseUrl: baseUrl },
    ),
  ).toBe('custom')
})

test('resolveActiveRouteIdFromEnv honors an explicit competing route over an ambient ApiSmart key', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      APISMART_API_KEY: 'apismart-key',
      AIMLAPI_API_KEY: 'aimlapi-key',
      OPENAI_BASE_URL: 'https://api.aimlapi.com/v1',
    }),
  ).toBe('aimlapi')
})

test('resolveActiveRouteIdFromEnv prefers dedicated AI/ML API key over ambient OpenAI keys', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      AIMLAPI_API_KEY: 'aimlapi-key',
      OPENAI_API_KEY: 'ambient-openai-key',
      OPENAI_API_KEYS: 'ambient-openai-key-a,ambient-openai-key-b',
    }),
  ).toBe('aimlapi')
})

test('resolveActiveRouteIdFromEnv prefers dedicated AI/ML API key over ambient compatible-provider keys', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      AIMLAPI_API_KEY: 'aimlapi-key',
      XAI_API_KEY: 'ambient-xai-key',
      MINIMAX_API_KEY: 'ambient-minimax-key',
    }),
  ).toBe('aimlapi')
})

test('resolveActiveRouteIdFromEnv keeps explicit OpenAI mode compatible with AI/ML API key-only setup', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      AIMLAPI_API_KEY: 'aimlapi-key',
      CLAUDE_CODE_USE_OPENAI: '1',
    }),
  ).toBe('aimlapi')
})

test('resolveActiveRouteIdFromEnv keeps explicit OpenAI mode compatible with ApiSmart key-only setup', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      APISMART_API_KEY: 'apismart-key',
      CLAUDE_CODE_USE_OPENAI: '1',
    }),
  ).toBe('apismart')
})

test('resolveActiveRouteIdFromEnv does not infer AI/ML API with a conflicting OpenAI base URL', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      AIMLAPI_API_KEY: 'aimlapi-key',
      OPENAI_API_KEY: 'ambient-openai-key',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    }),
  ).toBe('anthropic')
})

test('resolveActiveRouteIdFromEnv keeps an explicit non-OpenAI provider over AI/ML API key-only setup', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      AIMLAPI_API_KEY: 'aimlapi-key',
      CLAUDE_CODE_USE_GEMINI: '1',
    }),
  ).toBe('gemini')
})

test('resolveActiveRouteIdFromEnv ignores placeholder AI/ML API credential-only env', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      AIMLAPI_API_KEY: 'SUA_CHAVE',
    }),
  ).toBe('anthropic')
})

test('resolveActiveRouteIdFromEnv treats xAI credential-only env as xAI', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      XAI_API_KEY: 'xai-key',
    }),
  ).toBe('xai')
})

test('resolveActiveRouteIdFromEnv treats ClinePass credential-only env as ClinePass', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLINE_API_KEY: 'cline-key',
    }),
  ).toBe('clinepass')
})

test('resolveActiveRouteIdFromEnv prefers ClinePass key over Fireworks env-only intent', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLINE_API_KEY: 'cline-key',
      FIREWORKS_API_KEY: 'fw-key',
    }),
  ).toBe('clinepass')
})

test('resolveActiveRouteIdFromEnv prefers xAI when env-only keys compete', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      XAI_API_KEY: 'xai-key',
      MINIMAX_API_KEY: 'minimax-key',
    }),
  ).toBe('xai')
})

test('resolveActiveRouteIdFromEnv lets explicit MiniMax model beat ambient OpenAI-compatible env', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'openai-key',
      XAI_API_KEY: 'xai-key',
      MINIMAX_API_KEY: 'minimax-key',
      OPENAI_MODEL: 'MiniMax-M2.7',
    }),
  ).toBe('minimax')
})

test('resolveActiveRouteIdFromEnv does not use MiniMax when OpenAI base conflicts', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'openai-key',
      MINIMAX_API_KEY: 'minimax-key',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_MODEL: 'MiniMax-M2.7',
    }),
  ).toBe('openai')
})

test('resolveActiveRouteIdFromEnv keeps xAI primary base over stale API base', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      XAI_API_KEY: 'xai-key',
      OPENAI_BASE_URL: 'https://api.x.ai/v1',
      OPENAI_API_BASE: 'https://api.openai.com/v1',
    }),
  ).toBe('xai')
})

test('resolveActiveRouteIdFromEnv keeps MiniMax primary base over stale API base', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MINIMAX_API_KEY: 'minimax-key',
      OPENAI_BASE_URL: 'https://api.minimax.chat/v1',
      OPENAI_API_BASE: 'https://api.openai.com/v1',
    }),
  ).toBe('minimax')
})

test.each([
  ['MiniMax', 'https://api.minimax.io/v1', 'MiniMax-M2.7', 'minimax'],
  ['xAI', 'https://api.x.ai/v1', 'grok-4.3', 'xai'],
  ['NVIDIA NIM', 'https://integrate.api.nvidia.com/v1', 'nvidia/llama-3.1-nemotron-70b-instruct', 'nvidia-nim'],
  ['OpenRouter', 'https://openrouter.ai/api/v1', 'openai/gpt-5-mini', 'openrouter'],
  ['DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-v4-pro', 'deepseek'],
  ['Hicap', 'https://api.hicap.ai/v1', 'claude-opus-4.8', 'hicap'],
  ['aimlapi.com', 'https://api.aimlapi.com/v1', 'gpt-4o', 'aimlapi'],
  ['Xiaomi MiMo', 'https://api.xiaomimimo.com/v1', 'mimo-v2.5-pro', 'xiaomi-mimo'],
  ['Venice', 'https://api.venice.ai/api/v1', 'venice-uncensored', 'venice'],
])(
  'resolveActiveRouteIdFromEnv refines generic OpenAI profile by %s base URL',
  (_label, baseUrl, model, expectedRouteId) => {
    expect(
      resolveActiveRouteIdFromEnv(
        {
          CLAUDE_CODE_USE_OPENAI: '1',
          CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED: '1',
          OPENAI_BASE_URL: baseUrl,
          OPENAI_MODEL: model,
        },
        { activeProfileProvider: 'openai' },
      ),
    ).toBe(expectedRouteId)
  },
)

test('resolveActiveRouteIdFromEnv refines generic OpenAI profile by ClinePass base URL', () => {
  expect(
    resolveActiveRouteIdFromEnv(
      {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://api.cline.bot/api/v1',
        OPENAI_MODEL: 'cline-pass/deepseek-v4-flash',
      },
      { activeProfileProvider: 'openai' },
    ),
  ).toBe('clinepass')
})

test('resolveActiveRouteIdFromEnv resolves ClinePass profile provider without env applied flag', () => {
  expect(
    resolveActiveRouteIdFromEnv(
      {},
      { activeProfileProvider: 'clinepass' },
    ),
  ).toBe('clinepass')
})

test('resolveActiveRouteIdFromEnv resolves ClinePass profile provider without CLAUDE_CODE_USE_OPENAI', () => {
  expect(
    resolveActiveRouteIdFromEnv(
      {
        CLINE_API_KEY: 'cp-key',
      },
      { activeProfileProvider: 'clinepass' },
    ),
  ).toBe('clinepass')
})

test('resolveActiveRouteIdFromEnv still returns anthropic when no env flags and no profile provider', () => {
  expect(resolveActiveRouteIdFromEnv({})).toBe('anthropic')
})

test('resolveActiveRouteIdFromEnv resolves Atlas Cloud profile provider without env applied flag', () => {
  expect(
    resolveActiveRouteIdFromEnv(
      {},
      { activeProfileProvider: 'atlas-cloud' },
    ),
  ).toBe('atlas-cloud')
})

test('resolveActiveRouteIdFromEnv does not resolve custom profile provider as a known route', () => {
  expect(
    resolveActiveRouteIdFromEnv(
      {},
      { activeProfileProvider: 'custom' },
    ),
  ).toBe('anthropic')
})

test('resolveActiveRouteIdFromEnv resolves custom profile provider via ClinePass base URL', () => {
  expect(
    resolveActiveRouteIdFromEnv(
      {},
      {
        activeProfileProvider: 'custom',
        activeProfileBaseUrl: 'https://api.cline.bot/api/v1',
      },
    ),
  ).toBe('clinepass')
})

test('resolveActiveRouteIdFromEnv resolves openai profile provider via ClinePass base URL', () => {
  expect(
    resolveActiveRouteIdFromEnv(
      {
        CLAUDE_CODE_USE_OPENAI: '1',
      },
      {
        activeProfileProvider: 'openai',
        activeProfileBaseUrl: 'https://api.cline.bot/api/v1',
      },
    ),
  ).toBe('clinepass')
})

test('resolveActiveRouteIdFromEnv lets explicit OPENAI_BASE_URL override saved ClinePass profile', () => {
  expect(
    resolveActiveRouteIdFromEnv(
      {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
      },
      {
        activeProfileProvider: 'clinepass',
        activeProfileBaseUrl: 'https://api.cline.bot/api/v1',
      },
    ),
  ).toBe('openrouter')
})

test('resolveActiveRouteIdFromEnv does not infer MiniMax with OpenAI credentials', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MINIMAX_API_KEY: 'minimax-key',
      OPENAI_API_KEY: 'openai-key',
    }),
  ).toBe('anthropic')
})

test('resolveActiveRouteIdFromEnv does not infer MiniMax with pooled OpenAI credentials', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      MINIMAX_API_KEY: 'minimax-key',
      OPENAI_API_KEYS: 'openai-key-a,openai-key-b',
    }),
  ).toBe('anthropic')
})

test('resolveActiveRouteIdFromEnv infers Near AI with NEARAI_API_KEY and stale OPENAI_API_KEY', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      NEARAI_API_KEY: 'nearai-key',
      OPENAI_API_KEY: 'stale-openai-key',
    }),
  ).toBe('nearai')
})

test('resolveActiveRouteIdFromEnv does not infer Near AI when OPENAI_BASE_URL points elsewhere', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      NEARAI_API_KEY: 'nearai-key',
      OPENAI_API_KEY: 'openai-key',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    }),
  ).toBe('anthropic')
})

test('resolveActiveRouteIdFromEnv does not infer Near AI with explicit provider flag', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      NEARAI_API_KEY: 'nearai-key',
      OPENAI_API_KEY: 'openai-key',
      CLAUDE_CODE_USE_GEMINI: '1',
    }),
  ).toBe('gemini')
})

test('getRouteDefaultModel skips hidden and expired catalog entries in the fallback', async () => {
  // Self-contained registry mutation (same lock + clear + reload pattern as
  // registry.test.ts) so the synthetic gateway never leaks into other tests.
  await acquireSharedMutationLock('integrations/routeMetadata.test.ts')
  try {
    _clearRegistryForTesting()
    registerGateway({
      id: 'gw-default-fallback',
      label: 'gw-default-fallback',
      setup: { requiresAuth: true, authMode: 'api-key' },
      transportConfig: { kind: 'openai-compatible' },
      // No defaultModel on the descriptor → the catalog fallback path runs.
      catalog: {
        source: 'static',
        models: [
          // Marked default, but hidden — must be skipped.
          { id: 'hidden-default', apiName: 'model-hidden', default: true, hidden: true },
          // availableUntil already past its cutoff — must be skipped.
          {
            id: 'expired',
            apiName: 'model-expired',
            availableUntil: '2020-01-01T00:00:00Z',
          },
          { id: 'valid', apiName: 'model-valid' },
        ],
      },
    })
    expect(getRouteDefaultModel('gw-default-fallback')).toBe('model-valid')

    // Every entry filtered out → no implicit default at all, rather than an
    // id the route would reject.
    _clearRegistryForTesting()
    registerGateway({
      id: 'gw-default-fallback-empty',
      label: 'gw-default-fallback-empty',
      setup: { requiresAuth: true, authMode: 'api-key' },
      transportConfig: { kind: 'openai-compatible' },
      catalog: {
        source: 'static',
        models: [
          { id: 'hidden-only', apiName: 'model-hidden', hidden: true },
          {
            id: 'expired-only',
            apiName: 'model-expired',
            availableUntil: '2020-01-01T00:00:00Z',
          },
        ],
      },
    })
    expect(getRouteDefaultModel('gw-default-fallback-empty')).toBeUndefined()
  } finally {
    // Nested so the lock is released even if the registry restore throws
    // (same shape as registry.test.ts's afterEach).
    try {
      _clearRegistryForTesting()
      ensureIntegrationsLoaded()
    } finally {
      releaseSharedMutationLock()
    }
  }
})

test('isConcentrateBaseUrl matches the Concentrate API host', () => {
  expect(isConcentrateBaseUrl('https://api.concentrate.ai/v1')).toBe(true)
  expect(isConcentrateBaseUrl('https://api.concentrate.ai/v1/chat/completions')).toBe(true)
  expect(isConcentrateBaseUrl('http://api.concentrate.ai/v1')).toBe(false)
  expect(isConcentrateBaseUrl('https://api.concentrate.ai:8443/v1')).toBe(false)
  expect(isConcentrateBaseUrl('https://api.concentrate.ai.evil.test/v1')).toBe(false)
  expect(isConcentrateBaseUrl(undefined)).toBe(false)
})

test('resolveActiveRouteIdFromEnv treats Concentrate credential-only env as Concentrate', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CONCENTRATE_API_KEY: 'concentrate-key',
    }),
  ).toBe('concentrate')
})

test('resolveActiveRouteIdFromEnv uses CONCENTRATE_BASE_URL with a dedicated credential', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CONCENTRATE_API_KEY: 'concentrate-key',
      CONCENTRATE_BASE_URL: 'https://api.concentrate.ai/v1',
    }),
  ).toBe('concentrate')
})

test('resolveActiveRouteIdFromEnv uses CONCENTRATE_MODEL with a dedicated credential', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CONCENTRATE_API_KEY: 'concentrate-key',
      CONCENTRATE_MODEL: 'claude-sonnet-5',
    }),
  ).toBe('concentrate')
})

test('resolveActiveRouteIdFromEnv ignores placeholder Concentrate credentials', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CONCENTRATE_API_KEY: 'SUA_CHAVE',
    }),
  ).not.toBe('concentrate')
  expect(
    resolveActiveRouteIdFromEnv({
      CONCENTRATE_API_KEY: 'null',
    }),
  ).not.toBe('concentrate')
  expect(
    resolveActiveRouteIdFromEnv({
      CONCENTRATE_API_KEY: 'undefined',
    }),
  ).not.toBe('concentrate')
})

test('resolveActiveRouteIdFromEnv prefers Concentrate dedicated key over ambient OpenAI credentials', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CONCENTRATE_API_KEY: 'concentrate-key',
      OPENAI_API_KEY: 'ambient-openai-key',
      OPENAI_API_KEYS: 'ambient-openai-key-a,ambient-openai-key-b',
    }),
  ).toBe('concentrate')
})

test('explicit Concentrate config outranks an ambient LLMTR key', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      LLMTR_API_KEY: 'ambient-llmtr-key',
      CONCENTRATE_API_KEY: 'concentrate-key',
      CONCENTRATE_BASE_URL: 'https://api.concentrate.ai/v1',
      CONCENTRATE_MODEL: 'anthropic/claude-sonnet-4.6',
    }),
  ).toBe('concentrate')
})

test('resolveActiveRouteIdFromEnv does not infer Concentrate with a conflicting OpenAI base URL', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CONCENTRATE_API_KEY: 'concentrate-key',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    }),
  ).toBe('anthropic')
})

test('resolveActiveRouteIdFromEnv does not infer Concentrate from a same-host noncanonical base URL', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.concentrate.ai/staging/v1',
    }),
  ).toBe('custom')
})

test('resolveActiveRouteIdFromEnv keeps an explicit non-OpenAI provider over Concentrate key-only setup', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CONCENTRATE_API_KEY: 'concentrate-key',
      CLAUDE_CODE_USE_GEMINI: '1',
    }),
  ).toBe('gemini')
})

test('resolveActiveRouteIdFromEnv honors an explicit OpenAI opt-out over Concentrate', () => {
  expect(resolveActiveRouteIdFromEnv({ CLAUDE_CODE_USE_OPENAI: '0', CONCENTRATE_API_KEY: 'concentrate-key' })).not.toBe('concentrate')
})

test('resolveActiveRouteIdFromEnv refines generic OpenAI profile by Concentrate base URL', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.concentrate.ai/v1',
    }),
  ).toBe('concentrate')
})

test('getRouteCredentialEnvVars supports documented generic OpenAI Concentrate setup', () => {
  expect(getRouteCredentialEnvVars('concentrate')).toEqual([
    'CONCENTRATE_API_KEY',
    'OPENAI_API_KEYS',
    'OPENAI_API_KEY',
  ])
  expect(
    getRouteCredentialValue('concentrate', {
      OPENAI_API_KEY: 'generic-openai-key',
    }),
  ).toBe('generic-openai-key')
  expect(
    getRouteCredentialValue('concentrate', {
      OPENAI_API_KEY: 'generic-openai-key',
      CONCENTRATE_API_KEY: 'concentrate-key',
    }),
  ).toBe('concentrate-key')
})

test('resolveActiveRouteIdFromEnv does not let a stale Concentrate model override generic OpenAI', () => {
  expect(
    resolveActiveRouteIdFromEnv({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_API_KEY: 'generic-openai-key',
      CONCENTRATE_MODEL: 'deepseek-v4-flash-0731',
    }),
  ).toBe('openai')
})
