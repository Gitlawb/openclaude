import {
  getGithubEndpointType,
  isLocalProviderUrl,
  resolveCodexApiCredentials,
  resolveProviderRequest,
} from '../services/api/providerConfig.js'
import {
  type GeminiResolvedCredential,
  resolveGeminiCredential,
} from './geminiAuth.js'
import { redactSecretValueForDisplay } from './providerProfile.js'

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no'
}

type GithubTokenStatus = 'valid' | 'expired' | 'invalid_format'

const GITHUB_PAT_PREFIXES = ['ghp_', 'gho_', 'ghs_', 'ghr_', 'github_pat_']

function checkGithubTokenStatus(
  token: string,
  endpointType: 'copilot' | 'models' | 'custom' = 'copilot',
): GithubTokenStatus {
  // PATs work with GitHub Models but not with Copilot API
  if (GITHUB_PAT_PREFIXES.some(prefix => token.startsWith(prefix))) {
    if (endpointType === 'copilot') {
      return 'expired'
    }
    return 'valid'
  }

  const expMatch = token.match(/exp=(\d+)/)
  if (expMatch) {
    const expSeconds = Number(expMatch[1])
    if (!Number.isNaN(expSeconds)) {
      return Date.now() >= expSeconds * 1000 ? 'expired' : 'valid'
    }
  }

  const parts = token.split('.')
  const looksLikeJwt =
    parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))
  if (looksLikeJwt) {
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
      const json = Buffer.from(padded, 'base64').toString('utf8')
      const parsed = JSON.parse(json)
      if (parsed && typeof parsed === 'object' && parsed.exp) {
        return Date.now() >= (parsed.exp as number) * 1000 ? 'expired' : 'valid'
      }
    } catch {
      return 'invalid_format'
    }
  }

  // Keep compatibility with opaque token formats that do not expose expiry.
  return 'valid'
}

type GithubEndpointType = 'copilot' | 'models' | 'custom'

function githubAuthError(
  endpointType: GithubEndpointType,
  kind: 'missing' | 'expired' | 'invalid',
): string {
  if (endpointType === 'copilot') {
    switch (kind) {
      case 'missing':
        return 'GitHub Copilot authentication required.\n' +
          'Run /onboard-github in the CLI to sign in with your GitHub account.\n' +
          'This will store your OAuth token securely and enable Copilot models.'
      case 'expired':
        return 'GitHub Copilot token has expired.\n' +
          'Run /onboard-github to sign in again and get a fresh token.'
      case 'invalid':
        return 'GitHub Copilot token is invalid or corrupted.\n' +
          'Run /onboard-github to sign in again with your GitHub account.'
    }
  }
  // GitHub Models, custom, or future endpoint types
  switch (kind) {
    case 'missing':
      return 'GITHUB_TOKEN or GH_TOKEN is required for your GitHub endpoint.\n' +
        'Set one of these environment variables to a valid token.'
    case 'expired':
      return 'GitHub token has expired.\n' +
        'Set a fresh GITHUB_TOKEN or GH_TOKEN.'
    case 'invalid':
      return 'GitHub token is invalid or corrupted.\n' +
        'Check your GITHUB_TOKEN or GH_TOKEN.'
  }
}

export async function getProviderValidationError(
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    resolveGeminiCredential?: (
      env: NodeJS.ProcessEnv,
    ) => Promise<GeminiResolvedCredential>
  },
): Promise<string | null> {
  const useOpenAI = isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI)
  const useGithub = isEnvTruthy(env.CLAUDE_CODE_USE_GITHUB)

  if (isEnvTruthy(env.CLAUDE_CODE_USE_GEMINI)) {
    const geminiCredential = await (
      options?.resolveGeminiCredential ?? resolveGeminiCredential
    )(env)
    if (geminiCredential.kind === 'none') {
      return 'GEMINI_API_KEY, GOOGLE_API_KEY, GEMINI_ACCESS_TOKEN, or Google ADC credentials are required when CLAUDE_CODE_USE_GEMINI=1.'
    }
    return null
  }

  if (useGithub && !useOpenAI) {
    const token = (env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim()) ?? ''
    const endpointType = getGithubEndpointType(env.OPENAI_BASE_URL)
    if (!token) {
      return githubAuthError(endpointType, 'missing')
    }
    const status = checkGithubTokenStatus(token, endpointType)
    if (status === 'expired') {
      return githubAuthError(endpointType, 'expired')
    }
    if (status === 'invalid_format') {
      return githubAuthError(endpointType, 'invalid')
    }
    return null
  }

  if (!useOpenAI) {
    return null
  }

  const request = resolveProviderRequest({
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
  })

  if (env.OPENAI_API_KEY === 'SUA_CHAVE') {
    return 'Invalid OPENAI_API_KEY: placeholder value SUA_CHAVE detected. Set a real key or unset for local providers.'
  }

  if (request.transport === 'codex_responses') {
    const credentials = resolveCodexApiCredentials(env)
    if (!credentials.apiKey) {
      const authHint = credentials.authPath
        ? ` or put auth.json at ${credentials.authPath}`
        : ''
      const safeModel =
        redactSecretValueForDisplay(request.requestedModel, env) ??
        'the requested model'
      return `Codex auth is required for ${safeModel}. Set CODEX_API_KEY${authHint}.`
    }
    if (!credentials.accountId) {
      return 'Codex auth is missing chatgpt_account_id. Re-login with Codex or set CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID.'
    }
    return null
  }

  if (!env.OPENAI_API_KEY && !isLocalProviderUrl(request.baseUrl)) {
    const hasGithubToken = !!(env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim())
    if (useGithub && hasGithubToken) {
      return null
    }
    return 'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.'
  }

  return null
}

/**
 * Returns true when the user appears to be starting an interactive REPL session
 * (i.e. `openclaude` with no arguments or only flag-style arguments that don't
 * select a non-interactive sub-command).  In this mode we allow GitHub auth
 * errors through as warnings so the user can run /onboard-github from inside
 * the CLI rather than being locked out entirely.
 */
function isInteractiveReplMode(argv: string[] = process.argv.slice(2)): boolean {
  if (argv.length === 0) return true
  // Non-interactive sub-commands that should still hard-fail on missing auth
  const nonInteractiveSubcommands = new Set([
    'print', '-p', '--print',
    'run',
    'export',
    'config',
    'doctor',
  ])
  // If the first positional-looking argument is a known non-interactive
  // sub-command, don't allow the bypass.
  const firstArg = argv[0]
  if (firstArg && !firstArg.startsWith('-') && nonInteractiveSubcommands.has(firstArg)) {
    return false
  }
  return true
}

export async function validateProviderEnvOrExit(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const error = await getProviderValidationError(env)
  if (!error) return

  // For GitHub Copilot auth errors in interactive REPL mode, warn instead of
  // exiting so the user can run /onboard-github from within the CLI.
  // Only applies to the Copilot endpoint — GitHub Models and custom endpoints
  // have no in-CLI recovery path, so they should still hard-exit.
  const isGithubCopilotAuthError =
    isEnvTruthy(env.CLAUDE_CODE_USE_GITHUB) &&
    !isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI) &&
    getGithubEndpointType(env.OPENAI_BASE_URL) === 'copilot' &&
    (error.includes('authentication required') ||
      error.includes('token has expired') ||
      error.includes('token is invalid'))

  if (isGithubCopilotAuthError && isInteractiveReplMode()) {
    console.error(`Warning: ${error}\n`)
    return
  }

  console.error(error)
  process.exit(1)
}
