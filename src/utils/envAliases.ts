/**
 * Neutral environment variable aliases.
 * Maps provider-agnostic names to the underlying Anthropic vars
 * for backwards compatibility.
 *
 * Usage: instead of `process.env.ANTHROPIC_BASE_URL`, use
 * `getAliasedEnv('OPENLLM_BASE_URL')` which checks both names.
 */
const ENV_ALIASES: Record<string, string> = {
  OPENLLM_BASE_URL: 'ANTHROPIC_BASE_URL',
  OPENLLM_API_KEY: 'ANTHROPIC_API_KEY',
  OPENLLM_MODEL: 'ANTHROPIC_MODEL',
}

/**
 * Get an environment variable value, checking both the key and its alias.
 * @param key - The env var name to look up (may be an aliased name)
 * @returns The value if found, undefined otherwise
 */
export function getAliasedEnv(key: string): string | undefined {
  if (process.env[key] !== undefined) return process.env[key]
  const aliasKey = ENV_ALIASES[key]
  if (aliasKey && process.env[aliasKey] !== undefined) return process.env[aliasKey]
  return undefined
}
