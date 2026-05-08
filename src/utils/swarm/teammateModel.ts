import { getDefaultModelForProvider } from '../../integrations/modelCatalog/catalog.js'
import { getAPIProvider } from '../model/providers.js'

// When the user has never set teammateDefaultModel in /config, new teammates
// use the provider's opus-class catalog default.
export function getHardcodedTeammateModelFallback(): string {
  const provider = getAPIProvider()
  const catalogProvider = provider === 'firstParty'
    ? 'anthropic'
    : provider === 'github'
      ? 'github-copilot'
      : provider

  return (
    getDefaultModelForProvider(catalogProvider, 'opus') ??
    getDefaultModelForProvider(catalogProvider) ??
    getDefaultModelForProvider('anthropic', 'opus') ??
    'opus'
  )
}
