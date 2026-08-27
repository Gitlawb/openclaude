import { CLAUDE_OPUS_4_8_CONFIG, CLAUDE_OPUS_5_CONFIG } from '../model/configs.js'
import { getAPIProvider } from '../model/providers.js'

// @[MODEL LAUNCH]: Update the fallback model below.
// When the user has never set teammateDefaultModel in /config, new teammates
// use the current default Opus. Must be provider-aware so Bedrock/Vertex/Foundry
// customers get the correct model ID; 3P availability lags first party, so they
// stay on Opus 4.8 until Opus 5 rolls out there.
export function getHardcodedTeammateModelFallback(): string {
  const provider = getAPIProvider()
  return provider === 'firstParty'
    ? CLAUDE_OPUS_5_CONFIG.firstParty
    : CLAUDE_OPUS_4_8_CONFIG[provider]
}
