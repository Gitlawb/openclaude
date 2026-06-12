// Seeded from the Supported Providers table in the repo README.

export interface Provider {
  id: string
  name: string
  setup: string
  envVars?: string[]
  notes: string
}

export const providers: Provider[] = [
  {
    id: 'openai-compatible',
    name: 'OpenAI-compatible',
    setup: '/provider or env vars',
    envVars: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'],
    notes: 'Works with OpenAI, OpenRouter, DeepSeek, Groq, Mistral, LM Studio, and any other compatible /v1 server.',
  },
  {
    id: 'opengateway',
    name: 'Gitlawb Opengateway',
    setup: 'startup default, /provider, or env vars',
    envVars: ['OPENAI_API_KEY', 'OPENAI_MODEL'],
    notes: 'Smart gateway at https://opengateway.gitlawb.com/v1. Requires an API key from gitlawb.com/opengateway/keys; routes Xiaomi MiMo and GMI Cloud partner models by model name.',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    setup: '/provider or env vars',
    envVars: ['GOOGLE_API_KEY'],
    notes: 'Supports API-key auth only.',
  },
  {
    id: 'github-models',
    name: 'GitHub Models',
    setup: '/onboard-github',
    envVars: ['GITHUB_TOKEN'],
    notes: 'Interactive onboarding with saved credentials.',
  },
  {
    id: 'codex-oauth',
    name: 'Codex OAuth',
    setup: '/provider',
    notes: 'Opens ChatGPT sign-in in your browser and stores Codex credentials securely. Can also reuse existing Codex CLI auth or env credentials.',
  },
  {
    id: 'near-ai',
    name: 'NEAR AI',
    setup: '/provider or env vars',
    envVars: ['NEARAI_API_KEY'],
    notes: 'Unified gateway (Claude, GPT, Gemini, plus TEE open models) at https://cloud-api.near.ai/v1.',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    setup: '/provider or env vars',
    notes: 'Local inference with no API key required.',
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    setup: '/provider or env vars',
    envVars: ['OPENAI_BASE_URL'],
    notes: 'Local OpenAI-compatible server; point the base URL at the LM Studio endpoint.',
  },
  {
    id: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    setup: '/provider or env vars',
    envVars: ['MIMO_API_KEY'],
    notes: 'OpenAI-compatible API at https://mimo.mi.com; defaults to mimo-v2.5-pro.',
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen / Go',
    setup: '/provider or env vars',
    envVars: ['OPENCODE_API_KEY'],
    notes: 'Pay-as-you-go gateway (Zen) and subscription tier for open models (Go); both share one key via opencode.ai.',
  },
  {
    id: 'atomic-chat',
    name: 'Atomic Chat',
    setup: '/provider or env vars',
    notes: 'Local model provider with auto-detection of loaded models.',
  },
  {
    id: 'hicap',
    name: 'Hicap',
    setup: '/provider or OpenAI-compatible env vars',
    notes: 'api-key auth, discovers models from the unauthenticated /models endpoint, supports Responses mode for gpt- models.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    setup: '/login or env vars',
    envVars: ['ANTHROPIC_API_KEY'],
    notes: 'Sign in with an Anthropic account or use an API key directly.',
  },
  {
    id: 'cloud-routes',
    name: 'Bedrock / Vertex / Foundry',
    setup: 'env vars',
    notes: 'Anthropic-family cloud routes. Vertex is for Claude on Vertex AI, not arbitrary Model Garden models.',
  },
]
