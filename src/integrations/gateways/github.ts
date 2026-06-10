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
  vendorId: 'openai',
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
      supportsAuthHeaders: true,
      maxTokensField: 'max_tokens',
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
      {
        id: 'github-gpt-5.5',
        apiName: 'gpt-5.5',
        label: 'GPT-5.5 (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-5.5',
        contextWindow: 272_000,
        maxOutputTokens: 128_000,
      },
      {
        id: 'github-gpt-5.5-mini',
        apiName: 'gpt-5.5-mini',
        label: 'GPT-5.5 mini (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-5.5-mini',
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
      },
      {
        id: 'github-gpt-5.4',
        apiName: 'gpt-5.4',
        label: 'GPT-5.4 (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-5.4',
        contextWindow: 1_050_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-5.4-mini',
        apiName: 'gpt-5.4-mini',
        label: 'GPT-5.4 mini (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-5.4-mini',
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
      },
      {
        id: 'github-gpt-5.3-codex',
        apiName: 'gpt-5.3-codex',
        label: 'GPT-5.3-Codex (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-5.3-codex',
        contextWindow: 400_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-5.2-codex',
        apiName: 'gpt-5.2-codex',
        label: 'GPT-5.2-Codex (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-5.2-codex',
        contextWindow: 400_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-5.2',
        apiName: 'gpt-5.2',
        label: 'GPT-5.2 (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-5.2',
        contextWindow: 400_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-5.1-codex',
        apiName: 'gpt-5.1-codex',
        label: 'GPT-5.1-Codex (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-5.1-codex',
        contextWindow: 400_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-5.1-codex-max',
        apiName: 'gpt-5.1-codex-max',
        label: 'GPT-5.1-Codex-max (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-5.1-codex-max',
        contextWindow: 400_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-5.1-codex-mini',
        apiName: 'gpt-5.1-codex-mini',
        label: 'GPT-5.1-Codex-mini (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-5.1-codex-mini',
        contextWindow: 400_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-4.1',
        apiName: 'gpt-4.1',
        label: 'GPT-4.1 (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-4.1',
        contextWindow: 1_047_576,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-4o',
        apiName: 'gpt-4o',
        label: 'GPT-4o (GitHub)',
        modelDescriptorId: 'github:copilot:gpt-4o',
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
      },
      {
        id: 'github-claude-sonnet-4.6',
        apiName: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6 (GitHub)',
        modelDescriptorId: 'github:copilot:claude-sonnet-4.6',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      },
      {
        id: 'github-claude-sonnet-4.5',
        apiName: 'claude-sonnet-4-5',
        label: 'Claude Sonnet 4.5 (GitHub)',
        modelDescriptorId: 'github:copilot:claude-sonnet-4.5',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      },
      {
        id: 'github-claude-opus-4.6',
        apiName: 'claude-opus-4-6',
        label: 'Claude Opus 4.6 (GitHub)',
        modelDescriptorId: 'github:copilot:claude-opus-4.6',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      },
      {
        id: 'github-claude-opus-4.5',
        apiName: 'claude-opus-4-5',
        label: 'Claude Opus 4.5 (GitHub)',
        modelDescriptorId: 'github:copilot:claude-opus-4.5',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      },
      {
        id: 'github-claude-haiku-4.5',
        apiName: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5 (GitHub)',
        modelDescriptorId: 'github:copilot:claude-haiku-4.5',
        contextWindow: 144_000,
        maxOutputTokens: 8_192,
      },
      {
        id: 'github-gemini-3.1-pro-preview',
        apiName: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro Preview (GitHub)',
        modelDescriptorId: 'github:copilot:gemini-3.1-pro-preview',
        contextWindow: 128_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gemini-3-flash-preview',
        apiName: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash (GitHub)',
        modelDescriptorId: 'github:copilot:gemini-3-flash-preview',
        contextWindow: 128_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gemini-2.5-pro',
        apiName: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro (GitHub)',
        modelDescriptorId: 'github:copilot:gemini-2.5-pro',
        contextWindow: 1_048_576,
        maxOutputTokens: 65_536,
      },
      {
        id: 'github-grok-code-fast-1',
        apiName: 'grok-code-fast-1',
        label: 'Grok Code Fast 1 (GitHub)',
        modelDescriptorId: 'github:copilot:grok-code-fast-1',
        contextWindow: 256_000,
        maxOutputTokens: 32_768,
      },
    ],
  },
  usage: { supported: false },
})
