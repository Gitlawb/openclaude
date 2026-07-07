import { WebServer } from '../src/web/server.ts'
import { init } from '../src/entrypoints/init.ts'

// Polyfill MACRO which is normally injected by the bundler
Object.assign(globalThis, {
  MACRO: {
    VERSION: '0.2.3',
    DISPLAY_VERSION: '0.2.3',
    PACKAGE_URL: '@gitlawb/openclaude',
  }
})

async function main() {
  console.log('Starting OpenClaude Web UI...')
  await init()

  // Mirror CLI bootstrap: hydrate secure tokens and resolve provider profile
  const { enableConfigs } = await import('../src/utils/config.js')
  enableConfigs()
  const { applySafeConfigEnvironmentVariables } = await import('../src/utils/managedEnv.js')
  applySafeConfigEnvironmentVariables()

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
  await validateProviderEnvOrExit()

  const port = process.env.WEB_PORT ? parseInt(process.env.WEB_PORT, 10) : 3000
  const host = process.env.WEB_HOST || 'localhost'

  const server = new WebServer({ port, host })
  server.start()
}

main().catch((err) => {
  console.error('Fatal error starting web server:', err)
  process.exit(1)
})
