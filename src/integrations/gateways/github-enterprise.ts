import { defineGateway } from '../define.js'

/**
 * GitHub Copilot Enterprise gateway.
 *
 * Supports GitHub Enterprise Server (GHE) instances that host Copilot
 * behind a custom URL (e.g. *.ghe.com or self-hosted GHE).
 *
 * Configuration:
 *   GITHUB_ENTERPRISE_URL  — The base URL of the GHE instance
 *                            (e.g. https://github.mycompany.com)
 *   GITHUB_COPILOT_KEY     — Optional. Direct Copilot API key for auth.
 *                            If not set, uses GITHUB_TOKEN/GH_TOKEN with
 *                            OAuth device flow against the GHE instance.
 *
 * When GITHUB_ENTERPRISE_URL is set, the gateway:
 *   - Routes Copilot API requests to {GITHUB_ENTERPRISE_URL}/api/copilot
 *   - Uses GHE-specific OAuth device flow endpoints
 *   - Falls back to github.com if GITHUB_ENTERPRISE_URL is not set
 */
export default defineGateway({
  id: 'github-enterprise',
  label: 'GitHub Copilot Enterprise',
  vendorId: 'openai',
  category: 'hosted',
  defaultBaseUrl: 'https://api.githubcopilot.com',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'token',
    credentialEnvVars: ['GITHUB_COPILOT_KEY', 'GITHUB_TOKEN', 'GH_TOKEN'],
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
      'GitHub Copilot Enterprise authentication required.\n' +
      'Set GITHUB_ENTERPRISE_URL to your GHE instance URL (e.g. https://github.mycompany.com).\n' +
      'Then run /onboard-github to sign in, or set GITHUB_COPILOT_KEY for direct API key auth.',
    expiredCredentialMessage:
      'GitHub Copilot Enterprise token has expired.\nRun /onboard-github to sign in again.',
    invalidCredentialMessage:
      'GitHub Copilot Enterprise token is invalid or corrupted.\nRun /onboard-github to sign in again.',
  },
  catalog: {
    source: 'static',
    models: [
      {
        id: 'github-gpt-5.5',
        apiName: 'gpt-5.5',
        label: 'GPT-5.5 (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:gpt-5.5',
        contextWindow: 272_000,
        maxOutputTokens: 128_000,
      },
      {
        id: 'github-gpt-5.5-mini',
        apiName: 'gpt-5.5-mini',
        label: 'GPT-5.5 mini (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:gpt-5.5-mini',
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
      },
      {
        id: 'github-gpt-5.4',
        apiName: 'gpt-5.4',
        label: 'GPT-5.4 (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:gpt-5.4',
        contextWindow: 1_050_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-5.4-mini',
        apiName: 'gpt-5.4-mini',
        label: 'GPT-5.4 mini (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:gpt-5.4-mini',
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
      },
      {
        id: 'github-gpt-5.3-codex',
        apiName: 'gpt-5.3-codex',
        label: 'GPT-5.3-Codex (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:gpt-5.3-codex',
        contextWindow: 400_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-5.2-codex',
        apiName: 'gpt-5.2-codex',
        label: 'GPT-5.2-Codex (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:gpt-5.2-codex',
        contextWindow: 400_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-5.2',
        apiName: 'gpt-5.2',
        label: 'GPT-5.2 (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:gpt-5.2',
        contextWindow: 400_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-5.1-codex',
        apiName: 'gpt-5.1-codex',
        label: 'GPT-5.1-Codex (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:gpt-5.1-codex',
        contextWindow: 400_000,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-4.1',
        apiName: 'gpt-4.1',
        label: 'GPT-4.1 (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:gpt-4.1',
        contextWindow: 1_047_576,
        maxOutputTokens: 32_768,
      },
      {
        id: 'github-gpt-4o',
        apiName: 'gpt-4o',
        label: 'GPT-4o (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:gpt-4o',
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
      },
      {
        id: 'github-claude-sonnet-4.6',
        apiName: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6 (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:claude-sonnet-4.6',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      },
      {
        id: 'github-claude-sonnet-4.5',
        apiName: 'claude-sonnet-4-5',
        label: 'Claude Sonnet 4.5 (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:claude-sonnet-4.5',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      },
      {
        id: 'github-claude-opus-4.6',
        apiName: 'claude-opus-4-6',
        label: 'Claude Opus 4.6 (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:claude-opus-4.6',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      },
      {
        id: 'github-claude-opus-4.5',
        apiName: 'claude-opus-4-5',
        label: 'Claude Opus 4.5 (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:claude-opus-4.5',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      },
      {
        id: 'github-claude-haiku-4.5',
        apiName: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5 (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:claude-haiku-4.5',
        contextWindow: 144_000,
        maxOutputTokens: 8_192,
      },
      {
        id: 'github-gemini-2.5-pro',
        apiName: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:gemini-2.5-pro',
        contextWindow: 1_048_576,
        maxOutputTokens: 65_536,
      },
      {
        id: 'github-grok-code-fast-1',
        apiName: 'grok-code-fast-1',
        label: 'Grok Code Fast 1 (GitHub Enterprise)',
        modelDescriptorId: 'github:copilot:grok-code-fast-1',
        contextWindow: 256_000,
        maxOutputTokens: 32_768,
      },
    ],
  },
  usage: { supported: false },
})
