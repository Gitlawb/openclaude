import { defineGateway } from '../define.js'

/**
 * GitHub Copilot has a special native-Claude path for Claude models.
 * When the model string contains "claude-", the runtime routes through
 * the native Anthropic path instead of the OpenAI shim to enable prompt
 * caching. This exception is handled in openaiShim.ts and providers.ts
 * and must be preserved during migration.
 *
 * @see src/utils/model/providers.ts — isGithubNativeAnthropicMode()
 * @see src/services/api/openaiShim.ts — getGithubEndpointType()
 */
export default defineGateway({
  id: 'github',
  label: 'GitHub Copilot',
  category: 'hosted',
  defaultBaseUrl: 'https://api.githubcopilot.com',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'token',
    credentialEnvVars: ['GITHUB_TOKEN', 'GH_TOKEN'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsUserCustomHeaders: true,
    },
  },
  validation: {
    kind: 'github-token',
    routing: {
      enablementEnvVar: 'CLAUDE_CODE_USE_GITHUB',
      skipWhenUseOpenAI: true,
    },
    missingCredentialMessage:
      'GitHub Copilot authentication required.\nRun /onboard-github in the CLI to sign in with your GitHub account.\nThis will store your OAuth token securely and enable Copilot models.',
    expiredCredentialMessage:
      'GitHub Copilot token has expired.\nRun /onboard-github to sign in again and get a fresh token.',
    invalidCredentialMessage:
      'GitHub Copilot token is invalid or corrupted.\nRun /onboard-github to sign in again with your GitHub account.',
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'github-claude-sonnet', apiName: 'claude-sonnet-4-6', label: 'Claude Sonnet (GitHub)' },
      { id: 'github-gpt-4o', apiName: 'gpt-4o', label: 'GPT-4o (GitHub)' },
    ],
  },
  usage: { supported: false },
})
