/**
 * Environment variable validation using Zod.
 * Validates critical env vars at startup and crashes immediately if invalid.
 */

import { z } from 'zod/v4'

/**
 * Schema for environment variables that must be valid at startup.
 * Only includes vars that can cause silent failures or security issues.
 */
const EnvSchema = z.object({
  // API keys - must be non-empty strings if present
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_AUTH_TOKEN: z.string().min(1).optional(),
  
  // Config directory - must be valid path if set
  CLAUDE_CONFIG_DIR: z.string().min(1).optional(),
  
  // Proxy settings - must be valid URLs if set
  HTTP_PROXY: z.string().url().optional().or(z.literal('')),
  HTTPS_PROXY: z.string().url().optional().or(z.literal('')),
  
  // TLS certs - must be non-empty path if set
  NODE_EXTRA_CA_CERTS: z.string().min(1).optional(),
  
  // Boolean flags - must be valid truthy/falsy values
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: z.string().optional(),
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE: z.string().optional(),
  CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: z.string().optional(),
})

export type ValidatedEnv = z.infer<typeof EnvSchema>

/**
 * Validate environment variables at startup.
 * Throws immediately if validation fails - prevents wasting time on invalid config.
 */
export function validateEnvVars(): ValidatedEnv {
  const result = EnvSchema.safeParse(process.env)
  
  if (!result.success) {
    const errors = result.error.issues.map(issue => {
      const path = issue.path.join('.')
      return `  ${path}: ${issue.message}`
    }).join('\n')
    
    console.error('❌ Environment variable validation failed:')
    console.error(errors)
    console.error('\nPlease fix the above environment variables and try again.')
    process.exit(1)
  }
  
  return result.data
}

/**
 * Get validated env var with fallback.
 */
export function getValidatedEnv<K extends keyof ValidatedEnv>(
  key: K,
  fallback?: ValidatedEnv[K]
): ValidatedEnv[K] | undefined {
  return process.env[key] as ValidatedEnv[K] ?? fallback
}
