import { buildStartupEnvFromProfile } from './src/utils/providerProfile.js'
import { resolveActiveRouteIdFromEnv, resolveEnvOnlyProviderRouteId } from './src/integrations/routeMetadata.js'

const scenarios: Record<string, NodeJS.ProcessEnv> = {
  'sadece LLMTR_API_KEY': { LLMTR_API_KEY: 'llmtr-key' },
  'sadece APISMART_API_KEY (emsal, degismemeli)': { APISMART_API_KEY: 'apismart-key' },
  'LLMTR_API_KEY + alakasiz OPENAI_BASE_URL': { LLMTR_API_KEY: 'llmtr-key', OPENAI_BASE_URL: 'https://proxy.example/v1' },
  'LLMTR_API_KEY + Gemini secili': { LLMTR_API_KEY: 'llmtr-key', CLAUDE_CODE_USE_GEMINI: '1' },
}

for (const [name, env] of Object.entries(scenarios)) {
  const out = await buildStartupEnvFromProfile({ processEnv: { ...env } } as never)
  const e = (out ?? {}) as NodeJS.ProcessEnv
  console.log(`--- ${name} ---`)
  console.log('  envOnlyRouteId :', resolveEnvOnlyProviderRouteId(e))
  console.log('  OPENAI_BASE_URL:', e.OPENAI_BASE_URL)
  console.log('  route          :', resolveActiveRouteIdFromEnv(e))
}
