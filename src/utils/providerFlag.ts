/**
 * --provider CLI flag support.
 *
 * Maps the user-friendly provider name to the environment variables
 * that the rest of the codebase uses for provider detection.
 *
 * Usage:
 *   openclaude --provider openai --model gpt-4o
 *   openclaude --provider gemini --model gemini-2.0-flash
 *   openclaude --provider ollama --model llama3.2
 *   openclaude --provider anthropic   (default, no-op)
 */

export const VALID_PROVIDERS = [
  'anthropic',
  'openai',
  'gemini',
  'github',
  'bedrock',
  'vertex',
  'ollama',
  'nvidia-nim',
  'minimax',
] as const

export type ProviderFlagName = (typeof VALID_PROVIDERS)[number]

/**
 * Extract the value of --provider from argv.
 * Returns null if the flag is absent or has no value.
 */
export function parseProviderFlag(args: string[]): string | null {
  const idx = args.indexOf('--provider')
  if (idx === -1) return null
  const value = args[idx + 1]
  if (!value || value.startsWith('--')) return null
  return value
}

/**
 * Parse and apply --provider from argv in one step.
 * Returns undefined when the flag is absent.
 */
export function applyProviderFlagFromArgs(
  args: string[],
): { error?: string } | undefined {
  const provider = parseProviderFlag(args)
  if (!provider) return undefined
  return applyProviderFlag(provider, args)
}

/**
 * Extract the value of --model from argv.
 * Returns null if absent.
 */
function parseModelFlag(args: string[]): string | null {
  const idx = args.indexOf('--model')
  if (idx === -1) return null
  const value = args[idx + 1]
  if (!value || value.startsWith('--')) return null
  return value
}

/**
 * Apply a provider name to process.env.
 * Sets the required CLAUDE_CODE_USE_* flag and any provider-specific
 * defaults (Ollama base URL, model routing). Does NOT overwrite values
 * that are already set — explicit env vars always win.
 *
 * Returns { error } if the provider name is not recognized.
 */
export function applyProviderFlag(
  provider: string,
  args: string[],
): { error?: string } {
  if (!(VALID_PROVIDERS as readonly string[]).includes(provider)) {
    return {
      error: `Unknown provider "${provider}". Valid providers: ${VALID_PROVIDERS.join(', ')}`,
    }
  }

  const model = parseModelFlag(args)

  switch (provider as ProviderFlagName) {
    case 'anthropic':
      // Default — no env vars needed
      break

    case 'openai':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      if (model) process.env.OPENAI_MODEL ??= model
      break

    case 'gemini':
      process.env.CLAUDE_CODE_USE_GEMINI = '1'
      if (model) process.env.GEMINI_MODEL ??= model
      break

    case 'github':
      process.env.CLAUDE_CODE_USE_GITHUB = '1'
      if (model) process.env.OPENAI_MODEL ??= model
      break

    case 'bedrock':
      process.env.CLAUDE_CODE_USE_BEDROCK = '1'
      break

    case 'vertex':
      process.env.CLAUDE_CODE_USE_VERTEX = '1'
      break

    case 'ollama':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL ??= 'http://localhost:11434/v1'
      process.env.OPENAI_API_KEY ??= 'ollama'
      if (model) process.env.OPENAI_MODEL ??= model
      break

    case 'nvidia-nim':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL ??= 'https://integrate.api.nvidia.com/v1'
      process.env.NVIDIA_NIM = '1'
      process.env.OPENAI_MODEL ??= 'nvidia/nemotron-mini-4b-instruct'
      if (model) process.env.OPENAI_MODEL = model
      break

    case 'minimax':
      process.env.CLAUDE_CODE_USE_OPENAI = '1'
      process.env.OPENAI_BASE_URL ??= 'https://api.minimax.io/v1'
      process.env.OPENAI_MODEL ??= 'MiniMax-M2'
      if (model) process.env.OPENAI_MODEL = model
      break
  }

  return {}
}
