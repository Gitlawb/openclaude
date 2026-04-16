import { WebServer } from '../src/web/server.ts'
import { init } from '../src/entrypoints/init.ts'

Object.assign(globalThis, {
  MACRO: {
    VERSION: '0.3.0',
    DISPLAY_VERSION: '0.3.0',
    PACKAGE_URL: '@gitlawb/openclaude',
  }
})

// Global cache scope and other experimental betas require internal API support
// not available to external accounts. Disable by default for the web server.
if (!process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS) {
  process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
}

async function main() {
  console.log('Starting OpenClaude Web Server...')
  await init()

  const { enableConfigs } = await import('../src/utils/config.js')
  enableConfigs()
  const { applySafeConfigEnvironmentVariables } = await import('../src/utils/managedEnv.js')
  applySafeConfigEnvironmentVariables()
  const { hydrateGeminiAccessTokenFromSecureStorage } = await import('../src/utils/geminiCredentials.js')
  hydrateGeminiAccessTokenFromSecureStorage()
  const { hydrateGithubModelsTokenFromSecureStorage } = await import('../src/utils/githubModelsCredentials.js')
  hydrateGithubModelsTokenFromSecureStorage()

  const { buildStartupEnvFromProfile, applyProfileEnvToProcessEnv } = await import('../src/utils/providerProfile.js')
  const { getProviderValidationError, validateProviderEnvOrExit } = await import('../src/utils/providerValidation.js')
  const startupEnv = await buildStartupEnvFromProfile({ processEnv: process.env })
  if (startupEnv !== process.env) {
    const startupProfileError = await getProviderValidationError(startupEnv)
    if (startupProfileError) {
      console.warn(`Warning: ignoring saved provider profile. ${startupProfileError}`)
    } else {
      applyProfileEnvToProcessEnv(process.env, startupEnv)
    }
  }
  // Force registered provider profile to take priority over .env keys.
  // Bun loads .env into process.env before any code runs, which causes
  // applyActiveProviderProfileFromConfig to skip (it sees existing flags).
  // Forcing here ensures the OpenClaude-registered profile wins.
  const { applyActiveProviderProfileFromConfig } = await import('../src/utils/providerProfiles.js')
  applyActiveProviderProfileFromConfig(undefined, { force: true })

  await validateProviderEnvOrExit()

  const port = process.env.WEB_PORT ? parseInt(process.env.WEB_PORT, 10) : 3000
  const host = process.env.WEB_HOST || 'localhost'
  const server = new WebServer()

  server.start(port, host)
}

main().catch((err) => {
  console.error('Fatal error starting web server:', err)
  process.exit(1)
})
